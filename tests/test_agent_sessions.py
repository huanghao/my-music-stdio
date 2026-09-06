import pytest

from src import agent_sessions


@pytest.fixture(autouse=True)
def isolated_sessions_dir(monkeypatch, tmp_path):
    monkeypatch.setenv(agent_sessions.SESSIONS_DIR_ENV, str(tmp_path))
    yield


def test_create_append_and_load_messages_roundtrip():
    agent_sessions.create_session("s1")
    agent_sessions.append_user("s1", "什么是 II-V-I？")
    agent_sessions.append_assistant("s1", "II-V-I 是……", {
        "model": "fake-model", "thinking": "off", "duration_ms": 123,
    })

    messages = agent_sessions.load_messages("s1")
    assert [m["role"] for m in messages] == ["user", "assistant"]
    assert messages[0]["content"] == "什么是 II-V-I？"
    assert messages[1]["content"] == "II-V-I 是……"
    assert messages[1]["model"] == "fake-model"
    assert messages[1]["durationMs"] == 123
    assert messages[1]["done"] is True


def test_seed_history_on_create():
    agent_sessions.create_session("s2", seed_history=[
        {"role": "user", "content": "q1"},
        {"role": "assistant", "content": "a1"},
        {"role": "assistant", "content": ""},  # empty content skipped
        {"role": "user", "content": "q2"},
        {"role": "assistant", "content": "a2"},
    ])
    history = agent_sessions.load_history_for_prompt("s2", limit=8, message_chars=2000)
    assert [m["content"] for m in history] == ["q1", "a1", "q2", "a2"]


def test_create_session_is_idempotent_and_never_overwrites():
    agent_sessions.create_session("s3", seed_history=[
        {"role": "user", "content": "first"}, {"role": "assistant", "content": "a1"},
    ])
    agent_sessions.create_session("s3", seed_history=[
        {"role": "user", "content": "second"}, {"role": "assistant", "content": "a2"},
    ])
    history = agent_sessions.load_history_for_prompt("s3", 8, 2000)
    assert [m["content"] for m in history] == ["first", "a1"]


def test_aborted_turn_visible_but_excluded_from_prompt():
    agent_sessions.create_session("s4")
    agent_sessions.append_user("s4", "会被打断的问题")
    agent_sessions.append_aborted("s4", partial="回答到一半")
    agent_sessions.append_user("s4", "新问题")
    agent_sessions.append_assistant("s4", "新回答", {})

    history = agent_sessions.load_history_for_prompt("s4", 8, 2000)
    assert [m["content"] for m in history] == ["新问题", "新回答"]

    messages = agent_sessions.load_messages("s4")
    assert [m["role"] for m in messages] == ["user", "assistant", "user", "assistant"]
    assert messages[1]["interrupted"] is True
    assert messages[1]["content"] == "回答到一半"


def test_voided_removes_last_completed_turn_everywhere():
    agent_sessions.create_session("s5")
    agent_sessions.append_user("s5", "旧问题")
    agent_sessions.append_assistant("s5", "旧回答", {})
    agent_sessions.append_voided("s5")
    agent_sessions.append_user("s5", "重试问题")
    agent_sessions.append_assistant("s5", "重试回答", {})

    history = agent_sessions.load_history_for_prompt("s5", 8, 2000)
    assert [m["content"] for m in history] == ["重试问题", "重试回答"]
    messages = agent_sessions.load_messages("s5")
    assert [m["content"] for m in messages] == ["重试问题", "重试回答"]


def test_history_limit_and_message_clip():
    agent_sessions.create_session("s6")
    for i in range(6):  # 12 messages
        agent_sessions.append_user("s6", f"q{i}")
        agent_sessions.append_assistant("s6", f"a{i}", {})
    agent_sessions.append_user("s6", "x" * 3000)
    agent_sessions.append_assistant("s6", "ok", {})

    history = agent_sessions.load_history_for_prompt("s6", limit=8, message_chars=2000)
    assert len(history) == 8  # 14 messages total, oldest 3 pairs dropped
    assert history[0]["content"] == "q3"
    assert history[-2]["content"] == "x" * 2000
    assert history[-1]["content"] == "ok"


def test_trailing_unpaired_user_shown_but_not_in_prompt():
    """进程崩在回答中途：最后的 user 没有配对回答——不进 prompt，但作为
    未回答的普通气泡展示（提问记录不丢）。"""
    agent_sessions.create_session("s7")
    agent_sessions.append_user("s7", "q1")
    agent_sessions.append_assistant("s7", "a1", {})
    agent_sessions.append_user("s7", "崩溃前的问题")

    history = agent_sessions.load_history_for_prompt("s7", 8, 2000)
    assert [m["content"] for m in history] == ["q1", "a1"]
    messages = agent_sessions.load_messages("s7")
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "q1"), ("assistant", "a1"), ("user", "崩溃前的问题"),
    ]


def test_list_sessions_title_and_sorting():
    agent_sessions.create_session("s8")
    agent_sessions.append_user("s8", "第一条消息作为标题" + "长" * 40)
    agent_sessions.append_assistant("s8", "a", {})

    sessions = agent_sessions.list_sessions()
    assert [s["id"] for s in sessions] == ["s8"]
    assert sessions[0]["title"] == "第一条消息作为标题" + "长" * 21  # 30 chars total
    assert sessions[0]["message_count"] == 2
    assert "updated_at" in sessions[0]


def test_delete_session():
    agent_sessions.create_session("s9")
    assert agent_sessions.session_exists("s9")
    assert agent_sessions.delete_session("s9") is True
    assert not agent_sessions.session_exists("s9")
    assert agent_sessions.delete_session("s9") is False


def test_invalid_session_ids_rejected():
    for bad in ["", "../etc", "a/b", ".hidden", "x" * 65, "bad id"]:
        assert not agent_sessions.is_valid_id(bad)
        with pytest.raises(ValueError):
            agent_sessions.load_messages(bad)
        assert agent_sessions.delete_session(bad) is False


def test_load_messages_unknown_session_raises():
    with pytest.raises(ValueError):
        agent_sessions.load_messages("nonexistent")


def test_voided_with_crash_orphan_sealed_then_retried():
    """文件 u1 a1 u2(崩溃孤儿)：POST /runs 的正常路径会先 seal_unanswered
    封印孤儿（否则 u2 会 FIFO 错配走后面 run 的回答），retry 再 voided 掉
    a1 那轮。重建后：孤儿作为未回答气泡保留展示，retry 的新一轮配对干净。"""
    agent_sessions.create_session("s10")
    agent_sessions.append_user("s10", "q1")
    agent_sessions.append_assistant("s10", "a1", {})
    agent_sessions.append_user("s10", "crash-orphan")

    assert agent_sessions.seal_unanswered("s10") == 1
    agent_sessions.append_voided("s10")
    agent_sessions.append_user("s10", "q1-retry")
    agent_sessions.append_assistant("s10", "a1-retry", {})

    history = agent_sessions.load_history_for_prompt("s10", 8, 2000)
    assert [m["content"] for m in history] == ["q1-retry", "a1-retry"]
    messages = agent_sessions.load_messages("s10")
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "crash-orphan"), ("user", "q1-retry"), ("assistant", "a1-retry"),
    ]


def test_followup_turns_pair_fifo():
    """followup 排队的落盘序列是 u(Q) u(F) a(A1) a(A2)：A1 答 Q、A2 答 F，
    必须 FIFO 配对（LIFO 会把 A1 错配给 F，prompt 历史就乱了）。"""
    agent_sessions.create_session("s12")
    agent_sessions.append_user("s12", "原问题")
    agent_sessions.append_user("s12", "排队的追问")
    agent_sessions.append_assistant("s12", "原问题的回答", {})
    agent_sessions.append_assistant("s12", "追问的回答", {})

    history = agent_sessions.load_history_for_prompt("s12", 8, 2000)
    assert [m["content"] for m in history] == [
        "原问题", "原问题的回答", "排队的追问", "追问的回答",
    ]
    # 展示是时间正序：追问提问时原问题的回答还没出来，所以 F 的气泡在 A1 前面
    messages = agent_sessions.load_messages("s12")
    assert [(m["role"], m["content"]) for m in messages] == [
        ("user", "原问题"), ("user", "排队的追问"),
        ("assistant", "原问题的回答"), ("assistant", "追问的回答"),
    ]


def test_seal_unanswered_noop_when_no_pending():
    """没有未配对 user 时 seal_unanswered 不写墓碑，后续轮次照常配对。"""
    agent_sessions.create_session("s13")
    agent_sessions.append_user("s13", "q1")
    agent_sessions.append_assistant("s13", "a1", {})
    assert agent_sessions.seal_unanswered("s13") == 0

    agent_sessions.append_user("s13", "q2")
    agent_sessions.append_assistant("s13", "a2", {})
    history = agent_sessions.load_history_for_prompt("s13", 8, 2000)
    assert [m["content"] for m in history] == ["q1", "a1", "q2", "a2"]


def test_compacted_entry_replaces_covered_prefix():
    """compacted 条目落盘后，load_history_for_prompt 用摘要替代被覆盖的前缀。"""
    agent_sessions.create_session("s14")
    for i in range(4):
        agent_sessions.append_user("s14", f"q{i}")
        agent_sessions.append_assistant("s14", f"a{i}", {})
    agent_sessions.append_compacted("s14", "Summary of previous conversation:\n\n摘要是这个", 4)

    history = agent_sessions.load_history_for_prompt("s14", 100, 2000)
    assert [m["role"] for m in history] == ["system", "user", "assistant", "user", "assistant"]
    assert history[0]["content"].startswith("Summary of previous conversation:")
    # covers=4 覆盖 q0/a0/q1/a1，尾巴从 q2 开始
    assert [m["content"] for m in history[1:]] == ["q2", "a2", "q3", "a3"]


def test_compacted_entry_invalidated_by_voided():
    """voided（retry）会作废已完成轮次，被覆盖内容变脏 → 其后的摘要失效。"""
    agent_sessions.create_session("s15")
    for i in range(3):
        agent_sessions.append_user("s15", f"q{i}")
        agent_sessions.append_assistant("s15", f"a{i}", {})
    agent_sessions.append_compacted("s15", "Summary of previous conversation:\n\n旧摘要", 4)
    agent_sessions.append_voided("s15")

    history = agent_sessions.load_history_for_prompt("s15", 100, 2000)
    assert history[0]["role"] == "user"  # 摘要失效，回到普通重建
    assert [m["content"] for m in history] == ["q0", "a0", "q1", "a1"]  # 最后一轮被 voided


def test_compacted_entry_ignored_when_covers_out_of_range():
    agent_sessions.create_session("s16")
    agent_sessions.append_user("s16", "q0")
    agent_sessions.append_assistant("s16", "a0", {})
    agent_sessions.append_compacted("s16", "Summary of previous conversation:\n\nx", 99)

    history = agent_sessions.load_history_for_prompt("s16", 100, 2000)
    assert [m["content"] for m in history] == ["q0", "a0"]


def test_title_comes_from_first_surviving_turn():
    agent_sessions.create_session("s11")
    agent_sessions.append_user("s11", "被 retry 作废的原始问题")
    agent_sessions.append_assistant("s11", "a", {})
    agent_sessions.append_voided("s11")
    agent_sessions.append_user("s11", "真正保留的问题")
    agent_sessions.append_assistant("s11", "a", {})

    assert agent_sessions.list_sessions()[0]["title"] == "真正保留的问题"

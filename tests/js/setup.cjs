// Browser scripts share globals via <script> tags; node tests load them one by one.
global.lsJson = require('../../web/ls.js').lsJson;

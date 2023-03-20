"use strict";

const { TEXT, NODE, NAME, KEY, VALUE, SCRIPT, STYLE, COMMENT } = require("./states");

class SeqMatcher {
  constructor(str) {
    this.str = str;
    this.max = str.length - 1;
    this.pos = 0;
  }
  found(code) {
    if (code !== this.str.charCodeAt(this.pos)) return !!(this.pos = 0);
    if (this.pos === this.max) return !(this.pos = 0);
    return !++this.pos;
  }
  reset() {
    return !(this.pos = 0);
  }
}

module.exports = class HtmlParser {
  constructor({ preserveWS } = {}) {
    this.preserveWS = preserveWS;
    this.endScript = new SeqMatcher("</script>");
    this.endStyle = new SeqMatcher("</style>");
    this.beginComment = new SeqMatcher("!--");
    this.endComment = new SeqMatcher("-->");

    this.curPos = 0;
    this.minPos = 0;
    this.state = TEXT;

    this.cache = "";
    this.name = "";
    this.key = "";
    this.text = [];
    this.data = {};

    this.isClose = false;
    this.isSelfClose = false;
    this.hasEqual = false;
    this.valStartChar = null;
  }
  reset() {
    this.endScript.reset();
    this.endStyle.reset();
    this.beginComment.reset();
    this.endComment.reset();

    this.curPos = 0;
    this.minPos = 0;
    this.state = TEXT;

    this.cache = "";
    this.name = "";
    this.key = "";
    this.text = [];
    this.data = {};

    this.isClose = false;
    this.isSelfClose = false;
    this.hasEqual = false;
    this.valStartChar = null;
  }
  transform(chunk, controller) {
    const cache = this.cache += chunk;
    const cacheLen = cache.length;

    let i = this.curPos, v = this.minPos, s = this.state, c;
    while (i < cacheLen) {
      c = cache.charCodeAt(i);
      switch (s) {
        case TEXT: {
          if (!this.preserveWS && (c === 32 || c >= 9 && c <= 13)) { // ws
            if (v < i) this.text.push(cache.substring(v, i));
            v = i + 1;
          } else if (c === 60) { // <
            this.flushText(controller, v, i);
            s = NODE;
            v = i + 1;
          }
          break;
        }
        case NODE: {
          if (c === 62) { // >
            if (this.key) this.flushKey();
            s = this.flushNode(controller);
            v = i + 1;
          } else if (c === 47 && !this.hasEqual) { // /
            this.isClose = !(this.isSelfClose = !!this.name);
          } else if (c !== 32 && (c < 9 || c > 13)) { // !ws
            if (!this.name) { // name start
              this.beginComment.found(c);
              v = i;
              s = NAME;
            } else if (!this.key) { // key start
              v = i;
              s = KEY;
            } else if (c === 61) { // =
              this.hasEqual = true;
            } else if (!this.hasEqual) { // next key
              this.flushKey();
              v = i;
              s = KEY;
            } else if (c === 34 || c === 39) { // ', "
              v = i + 1;
              this.valStartChar = c;
              s = VALUE;
            } else { // un-quoted val
              v = i;
              s = VALUE;
            }
          }
          break;
        }
        case NAME: {
          if (this.beginComment.found(c)) { // start comment
            this.name = cache.substring(v, i + 1);
            s = this.flushNode(controller);
            v = i + 1;
          } else if (c === 32 || c >= 9 && c <= 13) { // ws
            this.name = cache.substring(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 47) { // /
            this.isSelfClose = true;
            this.name = cache.substring(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 62) { // >
            this.name = cache.substring(v, i);
            s = this.flushNode(controller);
            v = i + 1;
          }
          break;
        }
        case KEY: {
          if (c === 32 || c >= 9 && c <= 13) { // ws
            this.key = cache.substring(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 61) { // =
            this.hasEqual = true;
            this.key = cache.substring(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 47) { // /
            this.isSelfClose = true;
            this.key = cache.substring(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 62) { // >
            this.flushKey(v, i);
            s = this.flushNode(controller);
            v = i + 1;
          }
          break;
        }
        case VALUE: {
          if (this.valStartChar !== null) {
            if (c === this.valStartChar) { // found end quote
              this.flushVal(v, i);
              s = NODE;
              v = i + 1;
            }
          } else if (c === 32 || c >= 9 && c <= 13) { // ws
            this.flushVal(v, i);
            s = NODE;
            v = i + 1;
          } else if (c === 62) { // >
            this.flushVal(v, i);
            s = this.flushNode(controller);
            v = i + 1;
          }
          break;
        }
        default: {
          if (s === COMMENT && this.endComment.found(c)) {
            s = this.flushSpecialNode(controller, v, i - 2, "!--");
            v = i + 1;
          } else if (s === SCRIPT && this.endScript.found(c)) {
            s = this.flushSpecialNode(controller, v, i - 8, "script");
            v = i + 1;
          } else if (s === STYLE && this.endStyle.found(c)) {
            s = this.flushSpecialNode(controller, v, i - 7, "style");
            v = i + 1;
          }
        }
      }
      i++;
    }

    this.cache = cache.substring(v);
    this.curPos = i - v;
    this.minPos = 0;
    this.state = s;
  }
  flush(controller) {
    this.flushText(controller, this.minPos, this.curPos);
    this.reset();
  }
  flushKey(v, i) {
    this.key = this.data[this.key || this.cache.substring(v, i)] = "";
  }
  flushVal(v, i) {
    this.data[this.key] = this.cache.substring(v, i);
    this.key = "";
    this.valStartChar = this.hasEqual = null;
  }
  flushNode(controller) {
    const name = this.name;
    if (!this.isClose) controller.enqueue({ name, data: this.data });
    if (this.isSelfClose || this.isClose) controller.enqueue({ name });
    let s;
    switch (name) {
      case "script":
        s = SCRIPT;
        break;
      case "style":
        s = STYLE;
        break;
      case "!--":
        s = COMMENT;
        break;
      default:
        s = TEXT;
    }
    this.data = {};
    this.name = "";
    this.isClose = false;
    this.isSelfClose = false;
    return s;
  }
  flushSpecialNode(controller, v, i, name) {
    const text = this.cache.substring(v, i);
    if (text) controller.enqueue({ text });
    controller.enqueue({ name });
    return TEXT;
  }
  flushText(controller, v, i) {
    if (v < i) {
      this.text.push(this.cache.substring(v, i));
      controller.enqueue({ text: this.text.join(" ") });
      this.text.length = 0;
    } else if (this.text.length) {
      controller.enqueue({ text: this.text.join(" ") });
      this.text.length = 0;
    }
  }
};

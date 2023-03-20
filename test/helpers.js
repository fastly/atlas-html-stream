"use strict";

const { open } = require("node:fs/promises");
const { Readable } = require("node:stream");
const { it } = require("mocha");
const { join } = require("path");
const assetRoot = join(__dirname, "assets");
const HtmlParser = require("../src/HtmlParser");

module.exports = { parse, theyBoth, theyBothWithPreserveWSOption };

function theyBoth(should, name, test) {
  return theyBothWithPreserveWSOption(should, name, false, test);
}

// every test should also pass if chunks are super small
// - this simulates tokens which are split at chunk boundaries
//   e.g. parsing "chunk1 </sty", "le> chunk2" should capture a </style> tag.
function theyBothWithPreserveWSOption(should, name, preserveWS = true, test) {
  name = `${name}.html`;
  it(should, (done) => {
    parse({ name, preserveWS }, (err, res) => {
      err ? done(err) : test(res, done);
    });
  });
  it(`${should} across chunks`, (done) => {
    parse({ name, highWaterMark: 4, preserveWS }, (err, res) => {
      err ? done(err) : test(res, done);
    });
  });
}

// parse a file and return a list of results
async function parse({ name, highWaterMark, preserveWS }, cb) {
  const file = await open(join(assetRoot, name));
  const transform = new TransformStream(new HtmlParser({ preserveWS }));
  const options = highWaterMark ? { highWaterMark } : {};
  options.encoding = "utf-8";
  const readableStream = Readable.toWeb(file.createReadStream(options));
  const transformedStream = readableStream.pipeThrough(transform);

  const results = [];
  const reader = transformedStream.getReader();
  for (;;) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    } else {
      results.push(value);
    }
  }
  await file.close();
  cb(null, results);
}

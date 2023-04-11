'use strict';

const fs = require("graceful-fs");
const cp = require("child_process");
const crypto = require("crypto");

const {DOMParser} = require("xmldom");
const {Iconv} = require("iconv");

/* TODO PERF:
 * - Frontload reading in all XML files.
 * - Switch to using multiple threads for XML processing.
 */

module.exports = {
    md5File(file, callback) {
        const hash = crypto.createHash("md5");
        hash.setEncoding("hex");

        fs.createReadStream(file)
            .on("end", () => {
                hash.end();
                callback(hash.read());
            })
            .pipe(hash);
    },

    condCopyFile(from, to, callback) {
        fs.exists(to, exists => {
            if (exists) {
                return callback();
            }

            fs.createReadStream(from)
                .pipe(fs.createWriteStream(to))
                .on("close", callback);
        });
    },

    tidyHTML(html, outputFile, encoding, callback) {
        if (encoding) {
            html = (new Iconv(encoding, "UTF-8")).convert(html);
        }

        // Remove any script tags first (to fix any weird escaping)
        html = html.toString("utf8").replace(/<script[\s\S]*?<\/script>/ig, "");

        const tidy = cp.spawn(
            "tidy",
            [
                "-utf8",
                "-asxml",
                "--hide-comments",
                "yes",
                "--add-xml-decl",
                "yes",
                "--doctype",
                "transitional",
                "--quote-nbsp",
                "no",
                "--show-warnings",
                "0",
                "--force-output",
                "yes",
            ]
        );

        tidy.stdout
            .pipe(fs.createWriteStream(outputFile))
            .on("close", callback);

        tidy.stdin.write(html);
        tidy.stdin.end();
    },

    convertXML(htmlFile, xmlFile, encoding, callback) {
        fs.exists(xmlFile, exists => {
            if (exists) {
                return callback();
            }

            fs.readFile(htmlFile, (err, html) => {
                if (err) {
                    return callback(err);
                }

                this.tidyHTML(html, xmlFile, encoding, callback);
            });
        });
    },

    readXMLFile(xmlFile, callback) {
        fs.exists(xmlFile, exists => {
            if (!exists) {
                return callback({msg: `File does not exist: ${xmlFile}`});
            }

            fs.readFile(xmlFile, "utf8", (err, xmlData) => {
                // Strip out XMLNS to make XPath queries sane
                xmlData = xmlData.replace(/xmlns=\s*".*?"/g, "");

                // TODO: Catch any errors when parsing the XML
                const doc = new DOMParser().parseFromString(xmlData, "text/xml");
                callback(null, doc);
            });
        });
    },
};

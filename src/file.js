var fs = require("graceful-fs");
var cp = require("child_process");
var crypto = require("crypto");

var libxml = require("libxmljs");
var Iconv = require("iconv").Iconv;

/* TODO PERF:
 * - Frontload reading in all XML files.
 * - Switch to using multiple threads for XML processing.
 */

module.exports = {
    md5File: function(file, callback) {
        var hash = crypto.createHash("md5");
        hash.setEncoding("hex");

        fs.createReadStream(file)
            .on("end", function() {
                hash.end();
                callback(hash.read());
            })
            .pipe(hash);
    },

    condCopyFile: function(from, to, callback) {
        fs.exists(to, function(exists) {
            if (exists) {
                return callback();
            }

            fs.createReadStream(from)
                .pipe(fs.createWriteStream(to))
                .on("close", callback);
        });
    },

    tidyHTML: function(html, outputFile, encoding, callback) {
        if (encoding) {
            html = (new Iconv(encoding, "UTF-8")).convert(html);
        }

        var tidy = cp.spawn("tidy", [
            "-utf8",
            "-asxml",
            "--hide-comments", "yes",
            "--add-xml-decl", "yes",
            "--doctype", "transitional",
            "--show-warnings", "0",
            "--force-output", "yes"
        ]);

        tidy.stdout
            .pipe(fs.createWriteStream(outputFile))
            .on("close", callback);

        tidy.stdin.write(html);
        tidy.stdin.end();
    },

    convertXML: function(htmlFile, xmlFile, encoding, callback) {
        fs.exists(xmlFile, function(exists) {
            if (exists) {
                return callback();
            }

            fs.readFile(htmlFile, function(err, html) {
                if (err) {
                    return callback(err);
                }

                this.tidyHTML(html, xmlFile, encoding, callback);
            }.bind(this));
        }.bind(this));
    },

    readXMLFile: function(xmlFile, callback) {
        fs.exists(xmlFile, function(exists) {
            if (!exists) {
                return callback({msg: "File does not exist: " + xmlFile});
            }

            fs.readFile(xmlFile, "utf8", function(err, xmlData) {
                // Strip out XMLNS to make XPath queries sane
                xmlData = xmlData.replace(/xmlns=\s*".*?"/g, "");

                // TODO: Catch any errors when parsing the XML
                callback(null, libxml.parseXml(xmlData));
            });
        });
    }
};
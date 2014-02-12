var fs = require("fs");
var cp = require("child_process");

var libxml = require("libxmljs");
var Iconv = require("iconv").Iconv;

/* TODO PERF:
 * - Frontload reading in all XML files.
 * - Switch to using multiple threads for XML processing.
 */

module.exports = {
    walkTree: function(dir, callback, done) {
        var walkTree = this.walkTree;

        fs.readdir(dir, function(err, files) {
            files.forEach(function(file) {
                file = dir + file;
                fs.stat(file, function(err, stats) {
                    if (stats.isDirectory()) {
                        walkTree(file, callback);
                        return;
                    }

                    // Ignore images
                    if (exclude.some(function(ext) {
                        return file.indexOf(ext) >= 0;
                    })) {
                        return;
                    }

                    callback(null, file);
                });
            });
        });

        // TODO: Do this for real
        done();
    },

    md5File: function(file, callback) {
        cp.execFile("md5", ["-q", file], null, function(err, md5) {
            md5 = md5.toString().replace(/\s*/g, "");
            callback(md5);
        });
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
    }

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
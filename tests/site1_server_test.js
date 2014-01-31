module.exports = function(casper) {
    return {
        source: "site1",
        type: "server",
        scrape: [
            {
                start: "http://localhost:9876/",
                visit: function() {
                    casper.fill("form.form-search", {
                        "q": "turtle"
                    }, true);
                }
            },
            {
                visit: "//a[@class='img']",
                next: "//a[contains(@rel,'next')]"
            },
            {
                extract: {
                    "title": "//p[contains(@class, 'title')]//span",
                    "dateCreated": "//p[contains(@class, 'date')]//span",
                    "artists[]": "//p[contains(@class, 'artist')]//a",
                    "images[]": "//div[contains(@class,'imageholder')]//a/@href"
                }
            }
        ]
    };
};
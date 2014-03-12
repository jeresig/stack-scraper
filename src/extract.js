var _ = require("lodash");

module.exports = {
    extract: function(xmlDoc, selectors, data, accept) {
        if (typeof selectors === "function") {
            return selectors(data, xmlDoc);
        }

        for (var prop in selectors) {
            var type = selectors[prop],
                fixedProp = prop.replace(/\[\]/, ""),
                multi = prop !== fixedProp,
                val;

            if (typeof type === "string") {
                val = this.snag(xmlDoc, data, multi, type);
            } else if (typeof type === "function") {
                val = type(data);
            } else if (typeof type === "boolean") {
                val = type;
            } else {
                val = this.snag.apply(this,
                    [xmlDoc, data, multi].concat(type));
            }

            if (val != null) {
                data[fixedProp] = val;
            }
        }
    },

    snag: function(xmlDoc, data, multi, selector, process) {
        var ret;

        selector.split(/\s*\|\|\s*/).forEach(function(selector) {
            if (ret != null) {
                return;
            }

            var texts = this.getAllText(xmlDoc, this.cssToXPath(selector));

            if (texts.length > 0) {
                ret = multi ?
                    texts :
                    texts.join(" ");
            }
        }.bind(this));

        if (typeof ret === "string") {
            ret = this.getValue(ret, data, process) || undefined;

        } else if (ret) {
            ret = ret.map(function(val) {
                return this.getValue(val, data, process);
            }.bind(this)).filter(function(val) {
                return !!val;
            });

            // Remove duplicate values
            ret = _.uniq(ret);
        }

        return ret;
    },

    cssToXPath: function(selector) {
        return selector
            .replace(/#([\w_-]+)/g, "[@id='$1']")
            .replace(/\.([\w_-]+)(\/|\[| |$)/g,
                "[contains(@class,'$1')]$2")
            .replace(/^([^.\/])/, "//$1")
            .replace(/\/\[/g, "/*[");
    },

    getValue: function(val, data, process) {
        val = val.trim();

        if (process) {
            val = process(val, data) || "";
        }

        return !val || val instanceof Array ?
            val :
            String(val).trim().replace(/\s+/g, " ");
    },

    getText: function(node) {
        var text = "";

        if (node.nodeType === 1) {
            var childNodes = node.childNodes;
            for (var i = 0, l = childNodes.length; i < l; i++) {
                text += this.getText(childNodes[i]);
            }
        } else {
            text += node.nodeValue;
        }

        return text;
    },

    getAllText: function(xmlDoc, selector) {
        var results = xmlDoc.find(selector.path || selector);

        return (results || []).map(function(item) {
            return item.text ? item.text() : item.value();
        });
    }
};
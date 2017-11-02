'use strict';

const {uniq} = require("lodash");

module.exports = {
    extract(xmlDoc, selectors, data, accept) {
        if (typeof selectors === "function") {
            return selectors(data, xmlDoc);
        }

        for (const prop in selectors) {
            const type = selectors[prop];
            const fixedProp = prop.replace(/\[\]/, "");
            const multi = prop !== fixedProp;
            let val;

            if (typeof type === "string") {
                val = this.snag(xmlDoc, data, multi, type);
            } else if (typeof type === "function") {
                val = type(data);
            } else if (typeof type === "boolean") {
                val = type;
            } else {
                val = this.snag(xmlDoc, data, multi, ...type);
            }

            if (val != null) {
                data[fixedProp] = val;
            }
        }
    },

    snag(xmlDoc, data, multi, selector, process) {
        let ret;

        selector.split(/\s*\|\|\s*/).forEach(selector => {
            if (ret != null) {
                return;
            }

            selector.split(/\s*&&\s*/).forEach(selector => {
                const texts = this.getAllText(xmlDoc,
                    this.cssToXPath(selector));

                if (texts.length > 0) {
                    if (ret) {
                        if (multi) {
                            ret = ret.concat(texts);
                        } else {
                            ret += ` ${texts.join(" ")}`;
                        }
                    } else {
                        ret = multi ?
                            texts :
                            texts.join(" ");
                    }
                }
            });
        });

        if (typeof ret === "string") {
            ret = this.getValue(ret, data, process) || undefined;

        } else if (ret) {
            ret = ret
                .map(val => this.getValue(val, data, process))
                .filter(val => !!val);

            // Remove duplicate values
            ret = uniq(ret);
        }

        return ret;
    },

    cssToXPath(selector) {
        return selector
            .replace(/#([\w_-]+)/g, "[@id='$1']")
            .replace(/\.([\w_-]+)(\/|\[| |$)/g,
                "[contains(@class,'$1')]$2")
            .replace(/^([^.\/\(])/, "//$1")
            .replace(/\/\[/g, "/*[");
    },

    getValue(val, data, process) {
        val = val.trim();

        if (process) {
            val = process(val, data) || "";
        }

        return !val || typeof val === "object" ?
            val :
            String(val).trim().replace(/\s+/g, " ");
    },

    getText(node) {
        let text = "";

        if (node.nodeType === 1) {
            const childNodes = node.childNodes;
            for (let i = 0, l = childNodes.length; i < l; i++) {
                text += this.getText(childNodes[i]);
            }
        } else {
            text += node.nodeValue;
        }

        return text;
    },

    getAllText(xmlDoc, selector) {
        const results = xmlDoc.find(selector.path || selector);

        return (results || [])
            .map(item => (item.text ? item.text() : item.value()));
    },
};

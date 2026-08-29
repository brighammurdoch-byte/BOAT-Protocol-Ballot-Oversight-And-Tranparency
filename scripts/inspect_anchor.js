const a = require("@anchor-lang/core");
console.log(Object.keys(a).filter((k) => /bn|BN/i.test(k)));
console.log("BN type", typeof a.BN);
console.log("default keys sample", Object.keys(a).slice(0, 40));

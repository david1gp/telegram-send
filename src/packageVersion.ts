import pkg from "../package.json" with { type: "json" }

const packageVersion = pkg.version

export { packageVersion }

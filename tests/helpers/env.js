// tests/helpers/env.js
// The search path in an environment copied into a plain object. Windows names it `Path`, and
// only process.env itself reads it whatever the case, so a copy is looked up by name here.
export const searchPathIn = (env) => env[Object.keys(env).find((key) => key.toUpperCase() === 'PATH')];

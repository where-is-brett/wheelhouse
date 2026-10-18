// tests/helpers/host-key.js
// The environment the helper gives git for a narrow connection to the stand-in
// host: a key as http.extraHeader, carried in GIT_CONFIG_*, as connection.js does.
export function hostKeyEnv(hostUrl, token) {
  return {
    GH_TOKEN: token,
    GIT_CONFIG_COUNT: '1',
    GIT_CONFIG_KEY_0: `http.${hostUrl}/.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${Buffer.from(`x-access-token:${token}`, 'utf8').toString('base64')}`,
  };
}

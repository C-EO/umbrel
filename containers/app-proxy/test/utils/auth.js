const jwt = require("jsonwebtoken");

process.env.APP_HOST = process.env.APP_HOST || "app";
process.env.APP_MANIFEST_FILE =
  process.env.APP_MANIFEST_FILE || `${__dirname}/../fixtures/mempool-umbrel-app.yml`;
process.env.APP_PORT = process.env.APP_PORT || "3000";
process.env.JWT_SECRET = process.env.JWT_SECRET || "test-secret";
process.env.MANAGER_IP = process.env.MANAGER_IP || "10.21.21.4";
process.env.UMBREL_AUTH_SECRET = process.env.UMBREL_AUTH_SECRET || "test-auth-secret";

const auth = require("../../utils/auth.js");

function proxyToken() {
  return jwt.sign({ proxyToken: true }, process.env.JWT_SECRET, {
    algorithm: "HS256",
  });
}

describe("auth", () => {
  it("authorizes HTTPS requests with the Secure proxy token", async () => {
    const authorized = await auth.isAuthorized({
      cookieHeader: `__Host-UMBREL_PROXY_TOKEN_HTTPS=${proxyToken()}`,
      pathname: "/",
      secure: true,
    });

    assert.equal(authorized, true);
  });

  it("does not authorize HTTPS requests with only the HTTP proxy token", async () => {
    const authorized = await auth.isAuthorized({
      cookieHeader: `UMBREL_PROXY_TOKEN=${proxyToken()}`,
      pathname: "/",
      secure: true,
    });

    assert.equal(authorized, false);
  });

  it("authorizes HTTP requests with the HTTP proxy token", async () => {
    const authorized = await auth.isAuthorized({
      cookieHeader: `UMBREL_PROXY_TOKEN=${proxyToken()}`,
      pathname: "/",
      secure: false,
    });

    assert.equal(authorized, true);
  });
});

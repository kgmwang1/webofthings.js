import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

describe("secure discovery deployment contracts", () => {
  it("advertises a secure TD endpoint with only non-sensitive metadata", () => {
    const service = readFileSync(
      resolve("deploy/avahi/pi-display-wot.service"),
      "utf8",
    );

    expect(service).toContain("<type>_wot._tcp</type>");
    expect(service).toContain(
      "<txt-record>td=https://@HOST@:@PORT@/pidisplaysink</txt-record>",
    );
    expect(service).toContain("<txt-record>scheme=https</txt-record>");
    expect(service).toContain("<txt-record>path=/pidisplaysink</txt-record>");
    expect(service).not.toMatch(/password|username|authorization|credential|token/i);
  });

  it("assigns unsupported streamed-body and connection controls to the deployment proxy", () => {
    const boundary = readFileSync(
      resolve("deploy/nginx/pi-display-wot.conf"),
      "utf8",
    );

    expect(boundary).toContain("client_max_body_size 16k");
    expect(boundary).toContain("proxy_request_buffering on");
    expect(boundary).toContain("limit_conn pi_display_connections 8");
    expect(boundary).toContain("limit_req zone=pi_display_requests");
    expect(boundary).toContain("proxy_ssl_verify on");
    expect(boundary).toContain('proxy_set_header X-Forwarded-For ""');
  });
});
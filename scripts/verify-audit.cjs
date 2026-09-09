const chunks = [];

process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => chunks.push(chunk));
process.stdin.on("end", () => {
  const report = JSON.parse(chunks.join(""));
  if (report.error !== undefined || report.metadata?.vulnerabilities === undefined) {
    throw new Error(`npm audit did not return a vulnerability report: ${report.error?.summary ?? "unknown registry error"}`);
  }
  const counts = report.metadata.vulnerabilities;
  const allowedPackages = new Set([
    "@node-wot/binding-http",
    "decode-uri-component",
    "query-string",
  ]);
  const findings = Object.entries(report.vulnerabilities);

  if (counts.high !== 0 || counts.critical !== 0) {
    throw new Error("npm audit contains a high or critical finding");
  }
  if (counts.total !== 3 || counts.moderate !== 3) {
    throw new Error(`Expected exactly 3 moderate findings, received ${counts.total}`);
  }
  for (const [packageName, finding] of findings) {
    if (!allowedPackages.has(packageName) || finding.severity !== "moderate") {
      throw new Error(`Unexpected audit finding: ${packageName} (${finding.severity})`);
    }
  }

  console.log("Audit matches the approved three-moderate Node-WoT exception.");
});
/** Static actions only: never copy raw error content into diagnostic payloads. */
export function connectionHint(message: string): string {
  if (/expired|invalid.?token|jwt|unauthorized|\b401\b/i.test(message))
    return "Update the database authentication token with Change Database Credentials, then reconnect.";
  if (/certificate|self.signed|hostname.*match|unable.to.verify/i.test(message))
    return "Check the database hostname and CA certificate. Keep TLS verification enabled; use the provider's documented secure endpoint.";
  if (/host key changed/i.test(message))
    return "Independently verify the server fingerprint before using Forget SSH Host Key.";
  if (/econnrefused|connection refused/i.test(message))
    return "Check the host, port and database listener/firewall. With SSH, the database host is resolved from the SSH server.";
  if (/timeout|timed out|etimedout/i.test(message))
    return "Check network/private endpoint access, SSH routing and the database listener, then retry.";
  if (/authentication|password.*failed|access denied|login failed/i.test(message))
    return "Check the database user and authentication method; use Change Database Credentials. Server permissions may also restrict this operation.";
  return "";
}

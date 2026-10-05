/**
 * The customer's own MySQL, queried read-only by the flow's MySQL node (TW-FLR-034). Reference's Node bridge had no driver and posted
 * the connection to Laravel's PDO; here the node talks to this port and an adapter owns the driver.
 *
 * The node has already checked the statement (one SELECT or WITH, no file operations) and the host (`SafeFetch.assertPublicHost`),
 * and passes the address it checked: an adapter must connect to `address`, never look `host` up again. It must cap rows at
 * `maxRows`, give up after `timeoutMs`, and open the session read-only. A failure is thrown; the node turns it into an empty result.
 */
export const MYSQL_QUERY = Symbol('MYSQL_QUERY');

export interface MysqlQueryRequest {
  host: string;
  /** The address `host` resolved to and passed the public-host check. */
  address: string;
  port: number;
  database: string;
  username: string;
  password: string;
  sql: string;
  maxRows: number;
  timeoutMs: number;
}

export interface MysqlQueryPort {
  query(request: MysqlQueryRequest): Promise<Array<Record<string, unknown>>>;
}

/** The default until a driver is installed (no `mysql2` in this repo): every query fails with a clear reason. */
export class MysqlDriverUnavailable implements MysqlQueryPort {
  async query(): Promise<never> {
    throw new Error('MySQL driver is not installed on this server');
  }
}

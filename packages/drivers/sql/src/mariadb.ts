// MariaDB shares the MySQL wire protocol. Keep one permissively licensed transport;
// dialect-specific catalogs/SQL remain selected by the MariaDB driver identity.
export { connect } from "./mysql";

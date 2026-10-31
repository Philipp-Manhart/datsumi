import { connect } from "./mariadb";
import { serve } from "./worker";
serve("mariadb", connect);

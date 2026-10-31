import { connect } from "./mssql";
import { serve } from "./worker";
serve("mssql", connect);

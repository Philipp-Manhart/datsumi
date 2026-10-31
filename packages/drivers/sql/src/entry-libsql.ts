import { connect } from "./libsql";
import { serve } from "./worker";
serve("libsql", connect);

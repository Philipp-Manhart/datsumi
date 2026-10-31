import { connect } from "./mysql";
import { serve } from "./worker";
serve("mysql", connect);

import { connect } from "./oracle";
import { serve } from "./worker";
serve("oracle", connect);

import { connect } from "./turso";
import { serve } from "./worker";
serve("turso", connect);

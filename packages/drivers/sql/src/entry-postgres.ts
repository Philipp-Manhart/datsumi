import { connect } from "./postgres";
import { serve } from "./worker";
serve("postgres", connect);

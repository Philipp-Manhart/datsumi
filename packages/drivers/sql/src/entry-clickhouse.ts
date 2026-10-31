import { connect } from "./clickhouse";
import { serve } from "./worker";
serve("clickhouse", connect);

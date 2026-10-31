import { connectRedis } from "./redis";
import { serve } from "./worker";
serve("redis", connectRedis);

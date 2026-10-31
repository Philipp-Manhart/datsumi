import { connectMongo } from "./mongodb";
import { serve } from "./worker";
serve("mongodb", connectMongo);

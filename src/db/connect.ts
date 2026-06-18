import mongoose from "mongoose";
import { config } from "../config/env";

export const connectDb = async (): Promise<void> => {
  await mongoose.connect(config.mongodbUri);
};

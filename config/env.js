import { config } from "dotenv";

config({path: `.env.${process.env.NODE_ENV || "development"}.local`});
// Load environment variables from a .env file based on the NODE_ENV
 export const {
    PORT,
    NODE_ENV,
    DB_URL,
    JWT_SECRET,
    JWT_EXPIRES_IN
 }=process.env;
// Export the environment variables for use in other parts of the application
import authModel from "../models/authModel.js";
import jwt from "jsonwebtoken";

const authMiddleware = async(req, res, next) => {
    try{
        console.log("middleware triggered");

        //fetching the token from the request header
        const token = req.header("Authorization");
        console.log("token", token);

        //if token is not present, return an error
        if(!token){
            return res.status(401).json(
                {
                    message:"Token is invalid or not provided"
                }
            )
        }
        //verify the token
        const verify = jwt.verify(token, process.env.JWT_SECRET);
        console.log("verify", verify);

        //find the user in db
        req.user = await authModel.findById(verify.id).select("-password");
        console.log("user", req.user);

        if(!req.user){
            return res.status(404).json({
                message:"user not found"
            })
        }
        console.log("user authentication successfull, moving to next middleware");
        next();
    }
    catch(error){
        console.error("error in authmiddleware:", error);
        return res.status(500).json({
            message:"Internal server error"
    })
}
};

export default authMiddleware;
// This middleware checks if the user is authenticated by verifying the JWT token.

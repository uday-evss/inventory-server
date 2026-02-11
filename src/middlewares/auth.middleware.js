// // middleware/auth.middleware.js
// import jwt from "jsonwebtoken";
// import User from "../models/User.model.js";

// export const authenticate = async (req, res, next) => {
//     try {
//         const authHeader = req.headers.authorization;

//         if (!authHeader || !authHeader.startsWith("Bearer ")) {
//             return res.status(401).json({ message: "Not authenticated" });
//         }

//         const token = authHeader.split(" ")[1];

//         const decoded = jwt.verify(token, process.env.JWT_SECRET);

//         const user = await User.findByPk(decoded.id, {
//             attributes: ["id", "role", "email"],
//         });

//         if (!user) {
//             return res.status(401).json({ message: "User not found" });
//         }

//         // 🔥 THIS IS WHAT YOU ARE MISSING
//         req.user = user;

//         next();
//     } catch (error) {
//         return res.status(401).json({ message: "Invalid token" });
//     }
// };


// middleware/auth.middleware.js
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";

export const authenticate = async (req, res, next) => {
    try {
        const authHeader = req.headers.authorization;

        if (!authHeader || !authHeader.startsWith("Bearer ")) {
            return res.status(401).json({ message: "Not authenticated" });
        }

        const token = authHeader.split(" ")[1];
        const decoded = jwt.verify(token, process.env.JWT_SECRET);

        const user = await User.findByPk(decoded.id, {
            attributes: ["id", "role", "email", "company_id"],
        });

        if (!user) {
            return res.status(401).json({ message: "User not found" });
        }

        // 🔥 SINGLE SOURCE OF TRUTH
        req.user = {
            id: user.id,
            role: user.role,
            email: user.email,
            company_id: user.company_id,
        };

        next();
    } catch (error) {
        return res.status(401).json({ message: "Invalid token" });
    }
};

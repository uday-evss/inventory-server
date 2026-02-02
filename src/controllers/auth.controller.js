import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";
import { transporter } from "../config/mailer.js";
import { generatePassword } from "../utils/generatePassword.js";
import { forgotPasswordMail } from "../utils/forgotPassword.js";


//FOR USER LOGIN
export const loginUser = async (req, res, next) => {
    try {
        const { username, password } = req.body;

        if (!username || !password) {
            return res.status(400).json({
                message: "Username and password are required",
            });
        }

        const user = await User.findOne({ where: { username } });

        // ❌ Username not found
        if (!user) {
            return res.status(401).json({
                field: "username",
                message: "Entered username is incorrect",
            });
        }

        const isMatch = await bcrypt.compare(password, user.password);

        // ❌ Password mismatch
        if (!isMatch) {
            return res.status(401).json({
                field: "password",
                message: "Entered password is incorrect",
            });
        }

        const token = jwt.sign(
            { id: user.id, role: user.role },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        return res.status(200).json({
            message: "Login successful",
            token,
            user: {
                id: user.id,
                fullName: user.fullName,
                role: user.role,
                email: user.email,
                username: user.username,
                profilePic: user.profilePic,
                employeeId: user.employeeId,
                mobile: user.mobile,
            },
        });
    } catch (err) {
        next(err);
    }
};


// FORGOT PASSWORD
export const forgotPassword = async (req, res) => {
    try {
        const { email } = req.body;

        if (!email) {
            return res.status(400).json({ message: "Email is required" });
        }

        const user = await User.findOne({ where: { email } });

        // Always return success (security)
        if (!user) {
            return res.status(200).json({
                message: "If the email exists, a new password has been sent",
            });
        }

        // 1️⃣ Generate password
        const plainPassword = generatePassword();

        // 2️⃣ Hash password
        const hashedPassword = await bcrypt.hash(plainPassword, 10);

        // 3️⃣ Update DB
        await user.update({
            password: hashedPassword,
            forcePasswordChange: true,
            passwordUpdatedAt: new Date(),
        });

        // 4️⃣ Send mail
        const mail = forgotPasswordMail(user.fullName, plainPassword);

        await transporter.sendMail({
            from: `"KDM Engineers" <${process.env.MAIL_USER}>`,
            to: user.email,
            subject: mail.subject,
            text: mail.text,
        });

        return res.status(200).json({
            message: "If the email exists, a new password has been sent",
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
    }
};

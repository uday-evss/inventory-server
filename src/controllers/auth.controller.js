import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";
// import { transporter } from "../config/mailer.js";
import { generatePassword } from "../utils/generatePassword.js";
import { forgotPasswordMail } from "../utils/forgotPassword.js";
import { sendEmail } from "../config/mailer.js";



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
            { id: user.id, role: user.role, company_id: user.company_id },
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
                company_id: user.company_id
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
        console.log(email, 'user')
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

        const htmlContent = `
<div style="font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; max-width: 600px; margin: auto; border: 1px solid #e0e0e0; border-radius: 10px; overflow: hidden;">
  <div style="background-color: #004aad; color: white; padding: 20px; text-align: center;">
    <h1 style="margin: 0; font-size: 24px;">KDM Engineers Group</h1>
  </div>
  <div style="padding: 30px; text-align: center;">
    <h2 style="color: #333;">Password Reset Request</h2>
    <p style="color: #555; font-size: 16px;">Hello <strong>${user.fullName}</strong>,</p>
    <p style="color: #555; font-size: 16px;">You recently requested to reset your password. Use the new password below to login:</p>
    <div style="margin: 20px 0; padding: 15px; background-color: #f5f5f5; border-radius: 5px; font-size: 18px; font-weight: bold; color: #004aad;">
      ${plainPassword}
    </div>
    <p style="color: #555; font-size: 14px;">For security, we recommend you change this password after logging in.</p>
    <a href="https://inventory.kdmengineers.com/" style="display: inline-block; margin-top: 20px; padding: 10px 25px; background-color: #004aad; color: white; text-decoration: none; border-radius: 5px;">Login Now</a>
  </div>
  <div style="background-color: #f5f5f5; color: #777; padding: 15px; text-align: center; font-size: 12px;">
    &copy; 2026 KDM Engineers. All rights reserved.
  </div>
</div>
`;


        // await transporter.sendMail({
        //     from: `"KDM Engineers" <${process.env.MAIL_USER}>`,
        //     to: user.email,
        //     subject: mail.subject,
        //     text: mail.text,
        // });


        await sendEmail({
            to: user.email,
            subject: "Reset Your Password - KDM Engineers",
            html: htmlContent,
        });


        return res.status(200).json({
            message: "If the email exists, a new password has been sent",
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
    }
};

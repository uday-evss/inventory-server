import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import User from "../models/User.model.js";
// import { transporter } from "../config/mailer.js";
import { generatePassword } from "../utils/generatePassword.js";
import { forgotPasswordMail } from "../utils/forgotPassword.js";
// import { sendEmail } from "../config/mailer.js";
import { sendGraphMail } from "../config/mailer.js";


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
        // console.log(email, 'user')
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


        // 4️⃣ Send Microsoft Graph Mail
        await sendGraphMail({
          companyId: user.company_id,
          to: user.email,
          subject: `🔐 Password Reset | KDM Engineers Inventory System`,
          html: `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8" />
<meta name="viewport" content="width=device-width, initial-scale=1.0" />
<title>Password Reset</title>
</head>
<body style="margin:0;padding:0;background-color:#f4f6f9;font-family:Segoe UI, Arial, sans-serif;">

<table width="100%" cellpadding="0" cellspacing="0" style="padding:40px 0;background:#f4f6f9;">
<tr>
<td align="center">

<table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:12px;overflow:hidden;box-shadow:0 8px 30px rgba(0,0,0,0.08);">

<!-- Header -->
<tr>
<td style="background-color:#eff6ff;padding:30px;">
<h1 style="color:#1e3a8a;margin:0;font-size:22px;letter-spacing:0.5px;">
🔐 Password Reset Successful
</h1>
<p style="color:#2563eb;margin:8px 0 0 0;font-size:14px;">
KDM Engineers Inventory Management System
</p>
</td>
</tr>

<!-- Body -->
<tr>
<td style="padding:30px;color:#374151;font-size:14px;line-height:1.6;">
<p>Hello <strong>${user.fullName}</strong>,</p>

<p>
A password reset request was initiated for your account. 
Your new temporary password is provided below.
</p>

<div style="
margin:20px 0;
padding:18px;
background:#f3f4f6;
border-radius:8px;
text-align:center;
font-size:18px;
font-weight:700;
color:#111827;
letter-spacing:1px;
">
${plainPassword}
</div>

<p>
For security reasons, you will be required to change this password 
immediately after logging in.
</p>

<p style="color:#6b7280;font-size:13px;">
If you did not request this change, please contact your system administrator immediately.
</p>
</td>
</tr>

<!-- CTA -->
<tr>
<td align="center" style="padding:30px;">
<a href="https://inventory.kdmengineers.com"
style="
display:inline-block;
padding:14px 28px;
background:#2563eb;
color:#ffffff;
text-decoration:none;
border-radius:8px;
font-weight:600;
font-size:14px;
box-shadow:0 6px 16px rgba(37,99,235,0.4);
">
Login to Inventory System
</a>
</td>
</tr>

<!-- Footer -->
<tr>
<td style="background:#f9fafb;padding:20px;text-align:center;font-size:12px;color:#6b7280;">
This is an automated security notification from KDM Engineers Group.<br/>
© ${new Date().getFullYear()} KDM Engineers Group. All rights reserved.
</td>
</tr>

</table>
</td>
</tr>
</table>

</body>
</html>
`,
        });


        return res.status(200).json({
            message: "If the email exists, a new password has been sent",
        });
    } catch (err) {
        console.error(err);
        return res.status(500).json({ message: "Server error" });
    }
};

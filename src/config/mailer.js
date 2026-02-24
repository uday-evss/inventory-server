// import nodemailer from "nodemailer";

// export const transporter = nodemailer.createTransport({
//     host: process.env.MAIL_HOST,   // works for ALL providers
//     port: process.env.MAIL_PORT,
//     secure: false, // true for 465, false for 587
//     auth: {
//         user: process.env.MAIL_USER,
//         pass: process.env.MAIL_PASS, // App Password
//     },
// });

//----------------------------------------------------------------------------

// import sgMail from "@sendgrid/mail";

// sgMail.setApiKey(process.env.SENDGRID_API_KEY);

// export const sendEmail = async ({ to, subject, html }) => {
//     const msg = {
//         to,
//         from: process.env.FROM_EMAIL, // Make sure this is verified in SendGrid
//         subject,
//         html,
//     };

//     try {
//         await sgMail.send(msg);
//         console.log("Email sent successfully");
//     } catch (error) {
//         console.error("SendGrid Error:", error.response?.body || error.message);
//         throw new Error("Email sending failed");
//     }
// };


//-----------------------------------------------------------------------------

import axios from "axios";
import { ConfidentialClientApplication } from "@azure/msal-node";

const msalConfig = {
    auth: {
        clientId: process.env.AZURE_CLIENT_ID,
        authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
        clientSecret: process.env.AZURE_CLIENT_SECRET,
    },
};

const cca = new ConfidentialClientApplication(msalConfig);

export const sendGraphMail = async ({ to, subject, html }) => {
    try {
        const tokenResponse = await cca.acquireTokenByClientCredential({
            scopes: ["https://graph.microsoft.com/.default"],
        });

        const accessToken = tokenResponse.accessToken;

        await axios.post(
            `https://graph.microsoft.com/v1.0/users/info@kdmengineers.com/sendMail`,
            {
                message: {
                    subject,
                    body: {
                        contentType: "HTML",
                        content: html,
                    },
                    toRecipients: [
                        {
                            emailAddress: {
                                address: to,
                            },
                        },
                    ],
                },
                saveToSentItems: "true",
            },
            {
                headers: {
                    Authorization: `Bearer ${accessToken}`,
                    "Content-Type": "application/json",
                },
            }
        );
    } catch (err) {
        console.error("Graph Mail Error:", err.response?.data || err.message);
    }
};
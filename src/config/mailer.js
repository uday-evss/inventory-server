// import axios from "axios";
// import { ConfidentialClientApplication } from "@azure/msal-node";

// const msalConfig = {
//   auth: {
//     clientId: process.env.AZURE_CLIENT_ID,
//     authority: `https://login.microsoftonline.com/${process.env.AZURE_TENANT_ID}`,
//     clientSecret: process.env.AZURE_CLIENT_SECRET,
//   },
// };

// const cca = new ConfidentialClientApplication(msalConfig);

// export const sendGraphMail = async ({
//     companyId='550e8400-e29b-41d4-a716-446655440000',
//     to,
//     ccRecipients = [],
//     subject,
//     html,
// }) => {
//     try {
//         const tokenResponse = await cca.acquireTokenByClientCredential({
//             scopes: ["https://graph.microsoft.com/.default"],
//         });

//         const accessToken = tokenResponse.accessToken;

//         // Ensure TO is always array
//         const toArray = Array.isArray(to) ? to : [to];

//         const toFormatted = toArray.map(email => ({
//             emailAddress: { address: email },
//         }));

//         // Auto-convert plain emails to Graph format
//         const ccFormatted = ccRecipients.map(email =>
//             typeof email === "string"
//                 ? { emailAddress: { address: email } }
//                 : email
//         );

//         await axios.post(
//           `https://graph.microsoft.com/v1.0/users/info@kdmengineers.com/sendMail`,
//         //   `https://graph.microsoft.com/v1.0/users/info@shodh2s.com/sendMail`,

//           {
//             message: {
//               subject,
//               body: {
//                 contentType: "HTML",
//                 content: html,
//               },
//               toRecipients: toFormatted,
//               ccRecipients: ccFormatted, // ✅ THIS IS THE FIX
//             },
//             saveToSentItems: true,
//           },
//           {
//             headers: {
//               Authorization: `Bearer ${accessToken}`,
//               "Content-Type": "application/json",
//             },
//           },
//         );

//         // console.log("✅ Email sent successfully");
//     } catch (err) {
//         console.error("❌ Graph Mail Error:", err.response?.data || err.message);
//         throw err;
//     }
// };


import axios from "axios";
import { ConfidentialClientApplication } from "@azure/msal-node";

export const sendGraphMail = async ({
  companyId = "550e8400-e29b-41d4-a716-446655440000",
  to,
  ccRecipients = [],
  subject,
  html,
}) => {
  try {
    let clientId;
    let clientSecret;
    let tenantId;
    let senderEmail;

    // 🔥 Select credentials based on company
    if (companyId === "550e8400-e29b-41d4-a716-446655440000") {
      clientId = process.env.AZURE_CLIENT_ID_KDM;
      clientSecret = process.env.AZURE_CLIENT_SECRET_KDM;
      tenantId = process.env.AZURE_TENANT_ID_KDM;
      senderEmail = process.env.AZURE_MAIL_KDM;
    } else {
      clientId = process.env.AZURE_CLIENT_ID_SHODH;
      clientSecret = process.env.AZURE_CLIENT_SECRET_SHODH;
      tenantId = process.env.AZURE_TENANT_ID_SHODH;
      senderEmail = process.env.AZURE_MAIL_SHODH;
    }

    const msalConfig = {
      auth: {
        clientId,
        authority: `https://login.microsoftonline.com/${tenantId}`,
        clientSecret,
      },
    };

    const cca = new ConfidentialClientApplication(msalConfig);

    const tokenResponse = await cca.acquireTokenByClientCredential({
      scopes: ["https://graph.microsoft.com/.default"],
    });

    const accessToken = tokenResponse.accessToken;

    const toArray = Array.isArray(to) ? to : [to];

    const toFormatted = toArray.map((email) => ({
      emailAddress: { address: email },
    }));

    const ccFormatted = ccRecipients.map((email) =>
      typeof email === "string" ? { emailAddress: { address: email } } : email,
    );

    await axios.post(
      `https://graph.microsoft.com/v1.0/users/${senderEmail}/sendMail`,
      {
        message: {
          subject,
          body: {
            contentType: "HTML",
            content: html,
          },
          toRecipients: toFormatted,
          ccRecipients: ccFormatted,
        },
        saveToSentItems: true,
      },
      {
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
      },
    );
  } catch (err) {
    console.error("❌ Graph Mail Error:", err.response?.data || err.message);
    throw err;
  }
};
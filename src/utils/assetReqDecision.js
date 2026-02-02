export const requestDecisionTemplates = ({
    decision,
    siteName,
    requesterName,
}) => {
    if (decision === "APPROVED") {
        return {
            subject: "Asset Request Approved",
            message: `
Hello ${requesterName},

Your asset request for the site "${siteName}" has been APPROVED.

The requested items will be allocated by the Inventory Manager.
Please coordinate with the Inventory Manager for further proceedings and collection details.

Regards,
KDM Engineers India Pvt Ltd.
            `.trim(),
        };
    }

    if (decision === "REJECTED") {
        return {
            subject: "Asset Request Rejected",
            message: `
Hello ${requesterName},

Your asset request for the site "${siteName}" has been REJECTED.

This decision may be due to availability, priority conflicts, or policy constraints.
Please contact the Management or Inventory Team for further clarification or alternative arrangements.

Regards,
KDM Engineers India Pvt Ltd.`.trim(),
        };
    }

    return null;
};

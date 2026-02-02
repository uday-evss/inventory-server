import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetReturnRequest = sequelize.define(
    "AssetReturnRequest",
    {
        return_id: {
            type: DataTypes.CHAR(36),
            primaryKey: true,
            defaultValue: DataTypes.UUIDV4,
        },

        request_item_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        from_site_id: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        to_site_id: {
            type: DataTypes.CHAR(36),
            allowNull: true,
        },

        return_type: {
            type: DataTypes.ENUM("RETURN_TO_OFFICE", "TRANSFER_TO_SITE"),
            allowNull: false,
        },

        initiated_by: {
            type: DataTypes.CHAR(36),
            allowNull: false,
        },

        status: {
            type: DataTypes.ENUM(
                "INITIATED",
                "UNDER_REVIEW",
                "APPROVED",
                "REJECTED",
                "DISPATCHED",
                "RECEIVED"
            ),
            defaultValue: "INITIATED",
        },

        inventory_remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
        },

        receiver_remarks: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
    },
    {
        tableName: "asset_return_requests",
        timestamps: true,
        charset: "utf8mb4",
        collate: "utf8mb4_bin",
    }
);

AssetReturnRequest.associate = (models) => {

    AssetReturnRequest.belongsTo(models.AssetRequestItem, {
        foreignKey: "request_item_id",
        as: "requestItem",
    });

    AssetReturnRequest.belongsTo(models.SiteData, {
        foreignKey: "from_site_id",
        as: "fromSite",
    });

    AssetReturnRequest.belongsTo(models.SiteData, {
        foreignKey: "to_site_id",
        as: "toSite",
    });

    AssetReturnRequest.hasMany(models.AssetReturnItem, {
        foreignKey: "return_id",
        as: "items",
    });

    AssetReturnRequest.belongsTo(models.User, {
        foreignKey: "initiated_by",
        as: "initiatedBy",
    });


}


export default AssetReturnRequest;

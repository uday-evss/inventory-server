import { DataTypes } from "sequelize";
import sequelize from "../config/database.js";

const AssetRequestHistory = sequelize.define(
  "AssetRequestHistory",
  {
    history_id: {
      type: DataTypes.CHAR(36),
      primaryKey: true,
      defaultValue: DataTypes.UUIDV4,
      collate: "utf8mb4_bin",
    },

    req_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    req_user_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    admin_user_id: {
      type: DataTypes.UUID,
      allowNull: true,
    },

    req_nature: {
      type: DataTypes.ENUM("CREATED", "TRANSFERRED"),
      allowNull: false,
      defaultValue: "CREATED",
    },

    admin_approval: {
      type: DataTypes.ENUM("PENDING", "APPROVED", "REJECTED"),
      allowNull: false,
      defaultValue: "PENDING",
    },

    admin_advice: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    allocated: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    received_assets: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },

    received_asset_remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    priority_level: {
      type: DataTypes.ENUM("HIGH", "MEDIUM", "LOW"),
      allowNull: false,
      defaultValue: "MEDIUM",
    },

    site_id: {
      type: DataTypes.UUID,
      allowNull: false,
    },

    asset_origin: {
      type: DataTypes.ENUM("OFFICE", "SITE"),
      allowNull: false,
      defaultValue: "OFFICE",
    },

    origin_site_id: {
      type: DataTypes.CHAR(36),
      allowNull: true,
    },

    request_remarks: {
      type: DataTypes.TEXT,
      allowNull: true,
    },

    return_identity: {
      type: DataTypes.CHAR(36),
    },

    company_id: {
      type: DataTypes.CHAR(36),
      allowNull: false,
    },

    action_type: {
      type: DataTypes.ENUM(
        "CREATED",
        "APPROVED",
        "REJECTED",
        "DISPATCHED",
        "RECEIVED",
        "MERGED",
        "DELETED",
      ),
      allowNull: false,
    },

    action_by: {
      type: DataTypes.UUID,
      allowNull: true,
    },
  },
  {
    tableName: "asset_request_history",
    timestamps: true,
    createdAt: "action_at",
    updatedAt: false,
    charset: "utf8mb4",
    collate: "utf8mb4_bin",
  },
);

/* ================= ASSOCIATIONS ================= */

AssetRequestHistory.associate = (models) => {
  AssetRequestHistory.belongsTo(models.User, {
    foreignKey: "req_user_id",
    as: "requestedBy",
  });

  AssetRequestHistory.belongsTo(models.User, {
    foreignKey: "admin_user_id",
    as: "approvedBy",
  });

  AssetRequestHistory.belongsTo(models.SiteData, {
    foreignKey: "site_id",
    as: "site",
  });

  AssetRequestHistory.belongsTo(models.Company, {
    foreignKey: "company_id",
    as: "company",
  });
};

export default AssetRequestHistory;

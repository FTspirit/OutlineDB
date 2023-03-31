/* eslint-disable @typescript-eslint/no-unused-vars */
import {
  Column,
  ForeignKey,
  BelongsTo,
  Default,
  IsIn,
  Table,
  DataType,
  Scopes,
  PrimaryKey,
} from "sequelize-typescript";
import { DocumentPermission } from "@shared/types";
import Group from "./Group";
import BaseModel from "./base/BaseModel";
import ParanoidModel from "./base/ParanoidModel";
import Fix from "./decorators/Fix";

@Scopes(() => ({
  withUser: {
    include: [
      {
        association: "user",
      },
    ],
  },
  withCollection: {
    include: [
      {
        association: "collection",
      },
    ],
  },
}))
@Table({ tableName: "document_group", modelName: "document_group" })
@Fix
class DocumentGroup extends BaseModel {
  @Default(DocumentPermission.ReadWrite)
  @IsIn([Object.values(DocumentPermission)])
  @Column(DataType.STRING)
  permission: DocumentPermission;

  @PrimaryKey
  @Column(DataType.UUID)
  id: string;

  @Column(DataType.UUID)
  documentid: string;

  @Column(DataType.UUID)
  groupid: string;
}

export default DocumentGroup;

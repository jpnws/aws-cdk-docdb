#!/usr/bin/env node
import * as cdk from "aws-cdk-lib";
import "source-map-support/register";
import { AwsCdkDocdbStack } from "../lib/aws-cdk-docdb-stack";

const app = new cdk.App();
new AwsCdkDocdbStack(app, "AwsCdkDocdbStack", {
  env: {
    account: process.env.CDK_DEFAULT_ACCOUNT,
    region: process.env.CDK_DEFAULT_REGION,
  },
});

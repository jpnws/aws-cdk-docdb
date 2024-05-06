import * as cdk from "aws-cdk-lib";
import * as ddb from "aws-cdk-lib/aws-docdb";
import * as ec2 from "aws-cdk-lib/aws-ec2";
import * as ecs from "aws-cdk-lib/aws-ecs";
import * as elb from "aws-cdk-lib/aws-elasticloadbalancingv2";
import * as iam from "aws-cdk-lib/aws-iam";
import * as smg from "aws-cdk-lib/aws-secretsmanager";
import { Construct } from "constructs";

export class AwsCdkDocdbStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    // * =====================================
    // * Virtual Private Cloud (VPC)
    // * =====================================

    // Define the VPC and Security Group. You must define the public subnet
    // where containerized apps are deployed and the private subnet where
    // DocumentDB is deployed.
    const vpc = new ec2.Vpc(this, "VPC for DocumentDB", {
      subnetConfiguration: [
        {
          cidrMask: 24,
          name: "public",
          subnetType: ec2.SubnetType.PUBLIC,
        },
        {
          cidrMask: 24,
          name: "private",
          subnetType: ec2.SubnetType.PRIVATE_ISOLATED,
        },
      ],
    });

    // * =====================================
    // * DocumentDB
    // * =====================================

    // Define the security group for the DocumentDB cluster.
    const ddbSecurityGroup = new ec2.SecurityGroup(
      this,
      "DocumentDB Security Group",
      {
        vpc: vpc,
      }
    );

    // You can use the `aws-cdk-lib/aws-secretsmanager` to instantiate the
    // Secrets Manager construct. You can use `generateSecretString` property to
    // set the condition, such as length, excluding characters and punctuation,
    // acording to the app and security requirements, for the password that will
    // be generated. You also set the username that will be used to access the
    // DocumentDB cluster.
    const docDbCredentials = new smg.Secret(this, "DocumentDBCredentials", {
      generateSecretString: {
        secretStringTemplate: JSON.stringify({
          username: "awsdemo",
        }),
        generateStringKey: "password",
        passwordLength: 16,
        excludePunctuation: true,
        excludeCharacters: "/¥'%:;{}",
      },
    });

    // You can use `aws-cdk-lib/aws-docdb` module to instantiate the DocumentDB
    // construct. Specify the ARN of Secrets Manager as `docDbPasswordSecret`,
    // and define the VPC and subnet where you want to deploy the cluster,
    // instance type, and number of instances in the properties. You must define
    // the private subnet on this construct so that DocumentDB isn't accessible
    // via public endpoint. Here, we create a new DocumentDB cluster which we
    // attach to the VPC and provide it with the password that we created
    // previously.
    const docDbCluster = new ddb.DatabaseCluster(this, "DocDB", {
      masterUser: {
        username: docDbCredentials
          .secretValueFromJson("username")
          .unsafeUnwrap(),
        password: cdk.SecretValue.secretsManager(docDbCredentials.secretArn, {
          jsonField: "password",
        }),
      },
      vpc: vpc,
      vpcSubnets: vpc.selectSubnets({ subnetGroupName: "private" }),
      instanceType: ec2.InstanceType.of(
        ec2.InstanceClass.T3,
        ec2.InstanceSize.MEDIUM
      ),
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      // Define the security group for DocumentDB. You must define the security
      // group to allow incoming traffic from the containerized application's
      // security group.
      securityGroup: ddbSecurityGroup,
    });

    // * =====================================
    // * Elastic Container Service (ECS)
    // * =====================================

    // Define the security group for the ECS cluster.
    const ecsSecurityGroup = new ec2.SecurityGroup(this, "ECSSecurityGroup", {
      vpc: vpc,
    });

    // Create an ECS cluster.
    const ecsCluster = new ecs.Cluster(this, "ECSCluster", { vpc });

    // Create ECS task definition.
    const ecsTaskDefinition = new ecs.FargateTaskDefinition(
      this,
      "TaskDefinition"
    );

    // Add a container to the task definition.
    ecsTaskDefinition.addContainer("AppContainer", {
      image: ecs.ContainerImage.fromRegistry("amazon/amazon-ecs-sample"),
      memoryLimitMiB: 512,
      cpu: 256,
      environment: {
        EXAMPLE_ENV: "example_value",
      },
      portMappings: [
        {
          // Expose the container port.
          containerPort: 80,
        },
      ],
    });

    // Create an ECS service.
    const ecsService = new ecs.FargateService(this, "ECSService", {
      cluster: ecsCluster,
      taskDefinition: ecsTaskDefinition,
      securityGroups: [ecsSecurityGroup],
      assignPublicIp: true,
      vpcSubnets: vpc.selectSubnets({ subnetGroupName: "public" }),
    });

    // Application load balancer.
    const loadBalancer = new elb.ApplicationLoadBalancer(this, "LoadBalancer", {
      vpc: vpc,
      internetFacing: true,
    });

    // Add a listener to the load balancer and targets to listen.
    const loadBalancerListener = loadBalancer.addListener("Listener", {
      port: 80,
    });

    // Add the ECS service as a target to the load balancer listener.
    loadBalancerListener.addTargets("ECS", {
      port: 80,
      targets: [ecsService],
    });

    // * =====================================
    // * ECS and DocumentDB interaction setup.
    // * =====================================

    // Allow incoming traffic from the ECS security group to the DocumentDB
    // security group.
    ddbSecurityGroup.addIngressRule(
      ecsSecurityGroup,
      ec2.Port.tcp(27017),
      "Allow MongoDB traffic from ECS"
    );

    // Grant the ECS task permission to access the DocumentDB credentials.
    ecsTaskDefinition.taskRole.addToPrincipalPolicy(
      new iam.PolicyStatement({
        actions: ["secretsmanager:GetSecretValue"],
        resources: [docDbCredentials.secretArn],
      })
    );

    // Ensure that the ECS service depends on the DocumentDB cluster. This means
    // that the ECS service will only be created after the DocumentDB cluster is
    // created.
    ecsService.node.addDependency(docDbCluster);
  }
}

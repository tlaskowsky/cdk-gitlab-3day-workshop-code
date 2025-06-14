import * as cdk from 'aws-cdk-lib';
import { Template, Match } from 'aws-cdk-lib/assertions';
import { CoreStack } from '../lib/core-stack';
// We will add imports for Aspects later when setting up the test scope properly
import { BasicTagger } from '../lib/tagging-aspect';
import { ComplianceAspect } from '../lib/compliance-aspect';

// test/core-stack.test.ts
describe('CoreStack Tests', () => {
    let app: cdk.App;
    let stack: CoreStack;
    let template: Template;
  
    // Note: We will update this beforeAll later to apply Aspects
    beforeAll(() => {
      app = new cdk.App({
        // Ensure context needed by Aspects is provided
        context: {
          prefix: 'student20-dev',
          environment: 'dev',
          account: '683960772530',
          region: 'us-east-1'
        }
      });
      // Read context needed for tagger/stack ID AFTER app creation
      const prefix = app.node.tryGetContext('prefix');
      const environment = app.node.tryGetContext('environment');
      const stackId = `${prefix}-CoreStack`;
      stack = new CoreStack(app, stackId); // Instantiate stack

      // Apply Aspects to the test app scope BEFORE synthesis
      cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
      cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
      cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
      cdk.Aspects.of(app).add(new ComplianceAspect(), { priority: 10 }); // Apply Compliance Aspect with priority

      template = Template.fromStack(stack); // Synthesize AFTER applying aspects
    });
  
    // Test 1: Resource Counts
    test('Should create required core resources', () => {
      template.resourceCountIs('AWS::S3::Bucket', 1);
      template.resourceCountIs('AWS::SQS::Queue', 1);
      template.resourceCountIs('AWS::DynamoDB::Table', 1);
      template.resourceCountIs('AWS::CloudFormation::CustomResource', 1); // Check for Custom Resource
    });
  
    // Test 2: S3 Bucket Properties
    test('S3 Bucket should have versioning and encryption enabled', () => {
      template.hasResourceProperties('AWS::S3::Bucket', {
        VersioningConfiguration: { Status: 'Enabled' },
        BucketEncryption: { ServerSideEncryptionConfiguration: Match.arrayWith([ Match.objectLike({ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }) ]) },
        PublicAccessBlockConfiguration: Match.objectLike({ BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true })
      });
    });
  
    // Test 3: SQS Queue Properties
    test('SQS Queue should have SSE enabled and allow S3 notifications', () => {
      template.hasResourceProperties('AWS::SQS::Queue', {
        SqsManagedSseEnabled: true // Check for default SSE-SQS
      });
      // Check only essential parts of the Queue Policy Statement
      template.hasResourceProperties('AWS::SQS::QueuePolicy', {
        PolicyDocument: {
          Statement: Match.arrayWith([
            Match.objectLike({
              Effect: "Allow",
              Principal: { Service: "s3.amazonaws.com" },
              Action: Match.arrayWith(["sqs:SendMessage"]), // Check Action array contains SendMessage
              Resource: { "Fn::GetAtt": [Match.stringLikeRegexp("DocumentProcessingQueue"), "Arn"] }
            })
          ])
        }
      });
    });
  
    // Test 4: DynamoDB Table Properties (Assertion updated below)
    test('DynamoDB Table should have PITR Enabled and Tagged', () => {
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        BillingMode: 'PAY_PER_REQUEST',
        PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true } // Check PITR enabled
      });
      template.hasResourceProperties('AWS::DynamoDB::Table', {
        Tags: Match.arrayWith([ // Check Tag applied
          { Key: 'PITR-Enabled', Value: 'true' }
        ])
      });
    });
  
    // Test 5: Snapshot Test
    test('Core Stack should match snapshot', () => {
      expect(template.toJSON()).toMatchSnapshot();
    });
  
  }); // End describe block
  
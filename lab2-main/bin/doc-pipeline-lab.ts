#!/usr/bin/env node
import 'source-map-support/register';
import * as cdk from 'aws-cdk-lib';
import { CoreStack } from '../lib/core-stack';
import { ComputeStack } from '../lib/compute-stack';
import { BasicTagger } from '../lib/tagging-aspect'; // Import the aspect

const app = new cdk.App();

// --- Read Context Variables ---
// Get prefix and environment passed via -c flags from CI/CD.
// Provide sensible defaults for local execution if context isn't passed.
const environment = app.node.tryGetContext('environment') || 'dev'; // Default to 'dev'
// Default prefix combines 'stuXX' and environment. Replace 'stuXX' if using a different default/variable.
const prefix = app.node.tryGetContext('prefix') || `stu20-${environment}`;
console.log(`Using Prefix: ${prefix}, Environment: ${environment}`);

// --- Determine Target Account and Region ---
const targetAccount = app.node.tryGetContext('account') ||
                      process.env.CDK_DEFAULT_ACCOUNT ||
                      process.env.AWS_ACCOUNT_ID;
const targetRegion = app.node.tryGetContext('region') ||
                     process.env.CDK_DEFAULT_REGION ||
                     process.env.AWS_DEFAULT_REGION;

// Validate environment variables
if (!targetAccount) { throw new Error("Account environment variable not set"); }
if (!targetRegion) { throw new Error("Region environment variable not set"); }
console.log(`Targeting AWS Account: ${targetAccount} Region: ${targetRegion}`);

const deploymentProps = {
  env: { account: targetAccount, region: targetRegion },
};

// --- Instantiate Stacks ---
console.log('Instantiating CoreStack...');
const coreStack = new CoreStack(app, `${prefix}-CoreStack`, deploymentProps);
console.log('Instantiating ComputeStack...');

// VPC lookup is now done inside ComputeStack
const computeStack = new ComputeStack(app, `${prefix}-ComputeStack`, {
  ...deploymentProps,
  processingQueue: coreStack.queue,
});
// No need for explicit addDependency here

console.log('Stacks instantiated.');

// --- Apply Aspects ---
console.log('Applying aspects for tagging...');
// *** CHANGE: Use the environment variable for the tag ***
cdk.Aspects.of(app).add(new BasicTagger('environment', environment));
cdk.Aspects.of(app).add(new BasicTagger('project', 'doc-pipeline-workshop'));
// *** CHANGE: Add prefix tag ***
cdk.Aspects.of(app).add(new BasicTagger('prefix', prefix));
console.log('Tagging aspects applied.');

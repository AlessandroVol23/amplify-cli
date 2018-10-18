const fs = require('fs-extra');
const path = require('path');
const inquirer = require('inquirer'); 
const opn = require('opn');

const constants = require('./constants');
const authHelper = require('./auth-helper');
const writeAmplifyMeta = require('./writeAmplifyMeta');

async function ensureSetup(context){
  if(!isXRSetup(context)){
    authHelper.ensureAuth(context);
    await setupAccess(context); 
  }
}

async function setupAccess(context){
  let templateFilePath = path.join(__dirname, constants.TemplateFileName);
  let template = require(templateFilePath);

  const answer = await inquirer.prompt({
    name: 'allowUnAuthAccess',
    type: 'confirm',
    message: 'Allow unauthenticated users to access xr scenes',
    default: false,
  });

  if(!answer.allowUnAuthAccess){
    delete template.Resources.CognitoUnauthPolicy;
  }

  let parametersFilePath = path.join(__dirname, constants.ParametersFileName);
  let parameters = require(parametersFilePath);

  const { projectConfig, amplifyMeta } = context.exeInfo; 
  const providerInfo = amplifyMeta.providers[constants.ProviderPlugin];
  const decoratedProjectName = projectConfig.projectName + context.amplify.makeId(5);
  parameters.AuthRoleName = providerInfo.AuthRoleName;
  parameters.UnauthRoleName = providerInfo.UnauthRoleName;
  parameters.AuthPolicyName = 'sumerian-auth-' + decoratedProjectName;
  parameters.UnauthPolicyName = 'sumerian-unauth-' + decoratedProjectName;

  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const serviceDirPath = path.join(projectBackendDirPath, constants.CategoryName, constants.ServiceName);
  fs.ensureDirSync(serviceDirPath);

  templateFilePath = path.join(serviceDirPath, constants.TemplateFileName);
  let jsonString = JSON.stringify(template, null, 4);
  fs.writeFileSync(templateFilePath, jsonString, 'utf8');

  parametersFilePath = path.join(serviceDirPath, constants.ParametersFileName);
  jsonString = JSON.stringify(parameters, null, 4);
  fs.writeFileSync(parametersFilePath, jsonString, 'utf8');

  const metaData = {
    service: constants.ServiceName,
    providerPlugin: constants.ProviderPlugin
  };
  await context.amplify.updateamplifyMetaAfterResourceAdd(
    constants.CategoryName,
    constants.ServiceName,
    metaData,
  );

  context.exeInfo = context.amplify.getProjectDetails();
}

async function configureAccess(context){
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const serviceDirPath = path.join(projectBackendDirPath, constants.CategoryName, constants.ServiceName);
  const templateFilePath = path.join(serviceDirPath, constants.TemplateFileName);
  const template = require(templateFilePath);

  let isUnAuthAccessAllowed = false; 
  if(template.Resources.CognitoUnauthPolicy){
    isUnAuthAccessAllowed = true; 
  }

  const answer = await inquirer.prompt({
    name: 'allowUnAuthAccess',
    type: 'confirm',
    message: 'Allow unauthenticated users to access xr scenes',
    default: isUnAuthAccessAllowed,
  });

  if(!answer.allowUnAuthAccess){
    delete template.Resources.CognitoUnauthPolicy;
  }

  const jsonString = JSON.stringify(template, null, 4);
  fs.writeFileSync(templateFilePath, jsonString, 'utf8');
}

async function removeAccess(context){
  const projectBackendDirPath = context.amplify.pathManager.getBackendDirPath();
  const serviceDirPath = path.join(projectBackendDirPath, constants.CategoryName, constants.ServiceName);
  const templateFilePath = path.join(serviceDirPath, constants.TemplateFileName);
  const parametersFilePath = path.join(serviceDirPath, constants.ParametersFileName);
  fs.removeSync(templateFilePath);
  fs.removeSync(parametersFilePath);
}

async function configure(context){
  if(isXRSetup(context)){
    configureAccess(context);
  }else{
    context.print.error('You have NOT added the XR category yet.')
  }
}

function isXRSetup(context){
  const { amplifyMeta } = context.exeInfo; 
  return amplifyMeta[constants.CategoryName] &&
    amplifyMeta[constants.CategoryName][constants.ServiceName];
}

function getExistingScenes(context){
  let result = []; 
  if(isXRSetup(context)){
    const { amplifyMeta } = context.exeInfo; 
    if(amplifyMeta[constants.CategoryName][constants.ServiceName]['output']){
      result = Object.keys(amplifyMeta[constants.CategoryName][constants.ServiceName]['output']);
    }
  }
  return result; 
}

async function addScene(context){
  await ensureSetup(context); 
  context.print.info('Open the Amazon Sumerian console, and publish the scene you want to add.')
  context.print.info('Then download the JSON configuration to your local computer.');
  await inquirer.prompt({
    name: 'pressEnter',
    type: 'input',
    message: 'Press Enter when ready.'
  }); 

  let sceneConfig; 
  let sceneName; 

  await inquirer.prompt(
    {
      name: 'configFilePath',
      type: 'input',
      message: 'Enter the path to the downloaded JSON configuration file.',
      validate: (configFilePath)=>{
        try{
          if(fs.existsSync(configFilePath)){
            sceneConfig = require(configFilePath);
          }
        }catch(e){
        }
        if(sceneConfig){
          return true;
        }else{
          return `Can NOT ready the configuration, make sure it is valid.`;
        }
      }
    }
  );

  const existingScenes = getExistingScenes(context);
  await inquirer.prompt(
    {
      name: 'sceneName',
      type: 'input',
      message: 'Provide a name for the scene',
      validate: (name)=>{
        if(!existingScenes.includes(name)){
          return true;
        }else{
          return `${name} already exists, scene name must ben unique within the project`;
        }
      }
    }
  ).then((answer)=>{
    sceneName = answer.sceneName
  })

  const { amplifyMeta } = context.exeInfo; 
  if(!amplifyMeta[constants.CategoryName][constants.ServiceName]['output']){
    amplifyMeta[constants.CategoryName][constants.ServiceName]['output'] = {}; 
  }
  amplifyMeta[constants.CategoryName][constants.ServiceName]['output'][sceneName] = sceneConfig;
  writeAmplifyMeta(context);
}

function removeScene(context){
  const existingScenes = getExistingScenes(context); 
  if(existingScenes && existingScenes.length > 0){
    inquirer.prompt({
      name: 'existingScenes',
      message: 'Choose the scene to delete',
      type: 'list',
      choices: existingScenes,
    }).then((answer)=>{
      delete context.exeInfo.amplifyMeta[constants.CategoryName][constants.ServiceName]['output'][answer.existingScenes];
      writeAmplifyMeta(context);
    });
  }else{
    context.print.error('No scenes have been added to your project.');
  }
}

function console(context) {
  const amplifyMeta = context.amplify.getProjectMeta();
  const region = amplifyMeta.providers.awscloudformation.Region; 
  const consoleUrl =
          `https://console.aws.amazon.com/sumerian/home/start?region=${region}`;
  context.print.info(chalk.green(consoleUrl));
  opn(consoleUrl, { wait: false });
}

module.exports = {
  isXRSetup,
  ensureSetup,
  configure,
  getExistingScenes,
  addScene,
  removeScene,
  console
};

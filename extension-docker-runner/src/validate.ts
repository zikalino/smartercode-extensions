import * as helpers from '@zim.kalinowski/vscode-helper-toolkit';

console.log("Validation...");

var loader = new helpers.DefinitionLoader("./", "defs/____tree.yaml", true);
var templates = loader.getYaml();

if (templates === null) {
  var errors = loader.getErrors();

  for (var i = 0; i < errors.length; i++) {
    console.log(errors[i]);
  }

  console.log("** TOTAL VALIDATION ERRORS: " + errors.length);
  
  process.exit(1);
}
/*
 * View model for OctoPrint-CostEstimation
 *
 * Author: Sven Lohrmann <malnvenshorn@mailbox.org>
 * License: AGPLv3
 */

$(function() {

    function CostEstimationViewModel(parameters) {

        var PLUGIN_ID = "costestimation";

        var self = this;

        self.printerState = parameters[0];
        self.settings = parameters[1];
        self.loginState = parameters[2];
        self.filamentManager = parameters[3];
        self.spoolManager = parameters[4];
        self.filesViewModel = parameters[5];

        self.showEstimatedCost = ko.pureComputed(function() {
            return self.settings.settings.plugins.costestimation.requiresLogin() ?
                self.loginState.isUser() : true;
        });

        self.showFilamentGroup = ko.pureComputed(function() {
            // var filamentManagerDisabled = self.filamentManager === null || !self.settings.settings.plugins.costestimation.useFilamentManager();
            // var spoolManagerDisabled = self.spoolManager === null || !self.settings.settings.plugins.costestimation.useSpoolManager();
            // return !filamentManagerDisabled && !spoolManagerDisabled;
            return self.settings.settings.plugins.costestimation.useFilamentManager() == false && self.settings.settings.plugins.costestimation.useSpoolManager() == false;
        });

        self.lastCostResult = null;
        self.estimatedCostDetailsString = ko.observable();

        self.estimatedCostString = ko.pureComputed(function() {

            if (!self.showEstimatedCost()) return "user not logged in";
            if (self.printerState.filename() === undefined) return "no filename";
            if (self.printerState.filament().length == 0) return "no filament from meta";

            var pluginSettings = self.settings.settings.plugins.costestimation;
            self.selfPluginSettings = pluginSettings;
            var jobFilament =  self.printerState.filament();

            var withDefaultSpoolValues = false;
            var noSpoolValues = false;
            var spoolData = null;
            if (self.filamentManager !== null && pluginSettings.useFilamentManager()) {
                spoolData = self.filamentManager.selectedSpools();
            } else if (self.spoolManager !== null && pluginSettings.useSpoolManager()) {
                spoolData = self.readSpoolManagerData();
            }

            // - calculating filament cost
            var filamentCost = 0;
            for (var i = 0; i < jobFilament.length; ++i) {
                var result = /(\d+)/.exec(jobFilament[i].name()); // extract tool id from name
                var tool = result === null ? 0 : result[1];

                if (spoolData !== null && spoolData[tool] === undefined) {
                    noSpoolValues = true;
                    continue;  // skip tools with no selected spool
                }

                var costOfFilament, weightOfFilament, densityOfFilament, diameterOfFilament;

                if (spoolData !== null && spoolData[tool] !== null) {
                    costOfFilament = spoolData[tool].cost;
                    weightOfFilament =  spoolData[tool].weight;
                    densityOfFilament = spoolData[tool].profile.density;
                    diameterOfFilament = spoolData[tool].profile.diameter;
                } else {
                    withDefaultSpoolValues = true;
                    costOfFilament = parseFloat(pluginSettings.costOfFilament());
                    weightOfFilament = parseFloat(pluginSettings.weightOfFilament());
                    densityOfFilament = parseFloat(pluginSettings.densityOfFilament());
                    diameterOfFilament = parseFloat(pluginSettings.diameterOfFilament());
                }

                var costPerWeight = weightOfFilament > 0 ? costOfFilament / weightOfFilament : 0;
                var filamentLength = jobFilament[i].data().length;
                var filamentVolume = self.calculateVolume(filamentLength, diameterOfFilament) / 1000;

                filamentCost += costPerWeight * filamentVolume * densityOfFilament;
            }

            formatCurrency = function(currencyValue){
                var currencySymbol = self.selfPluginSettings.currency();
                var currencyFormat = self.selfPluginSettings.currencyFormat();
                var costsFormatted = currencyFormat.replace("%v", currencyValue.toFixed(2)).replace("%s", currencySymbol);
                return costsFormatted;
            }

            // - calculating electricity cost
            var powerConsumption = parseFloat(pluginSettings.powerConsumption());
            var costOfElectricity = parseFloat(pluginSettings.costOfElectricity());
            var costPerHour = powerConsumption * costOfElectricity;
            var estimatedPrintTime = self.printerState.estimatedPrintTime() / 3600;  // h
            var electricityCost = costPerHour * estimatedPrintTime;

            // - calculating printer cost
            var purchasePrice = parseFloat(pluginSettings.priceOfPrinter());
            var lifespan = parseFloat(pluginSettings.lifespanOfPrinter());
            var depreciationPerHour = lifespan > 0 ? purchasePrice / lifespan : 0;
            var maintenancePerHour = parseFloat(pluginSettings.maintenanceCosts());
            var printerCost = (depreciationPerHour + maintenancePerHour) * estimatedPrintTime;

            // assembling string
            var estimatedCost = filamentCost + electricityCost + printerCost;
            var currencySymbol = pluginSettings.currency();
            var currencyFormat = pluginSettings.currencyFormat();
            var totalCostsFormatted = currencyFormat.replace("%v", estimatedCost.toFixed(2)).replace("%s", currencySymbol);
            if (withDefaultSpoolValues == true){
                totalCostsFormatted += " (with default Spool-Values)";
            }
            if (noSpoolValues == true){
                totalCostsFormatted += " (no Spool-Values)";
            }

            var filename = self.printerState.filename();
            var filepath = self.printerState.filepath();

            var costData = {
                filename: filename,
                filepath: filepath,
                totalCosts: estimatedCost,
                totalCostsFormatted: totalCostsFormatted,
                filamentCost: filamentCost,
                electricityCost: electricityCost,
                printerCost: printerCost,
                currencySymbol: currencySymbol,
                currencyFormat: currencyFormat,
                withDefaultSpoolValues: withDefaultSpoolValues
            }
            // send only if the result is changed
            if (self.lastCostResult != totalCostsFormatted) {
                // console.error(self.lastCostResult + "  " + totalCostsFormatted);
                self.lastCostResult = totalCostsFormatted;
                self.callSendCostsToServer(costData, function (responseData) {
                    // do nothing
                });
            }

            var estimatedCostDetailsString = ""
            + "Est. Printtime: " + formatDuration(self.printerState.estimatedPrintTime()) +"\n"
            + "\n"
            + "* Filament: " + formatCurrency(filamentCost) + "\n"
            + "* Electricity: " + formatCurrency(electricityCost) + "\n"
            + "* Printer: " + formatCurrency(printerCost) +"\n";


            self.estimatedCostDetailsString(estimatedCostDetailsString);

            return totalCostsFormatted;
        });

        self.calculateVolume = function(length, diameter) {
            var radius = diameter / 2;
            return length * Math.PI * radius * radius;
        };

        self.onBeforeBinding = function() {
            var element = $("#state").find("hr:nth-of-type(2)");
            if (element.length) {
                var name = gettext("Cost");
                var text = gettext("Estimated print cost based on required quantity of filament and print time");
                element.before("<div id='costestimation_string' data-bind='visible: showEstimatedCost()'>" +
                    "<span title='" + text + "'>" + name + "</span>: <strong data-bind='text: estimatedCostString, attr:{title: estimatedCostDetailsString}'></strong>" +
                    "</div>");
            }

            self.settings.settings.plugins.costestimation.useFilamentManager.subscribe(function(newValue){
                if (newValue == true){
                    self.settings.settings.plugins.costestimation.useSpoolManager(false);
                }
            });
            self.settings.settings.plugins.costestimation.useSpoolManager.subscribe(function(newValue){
                if (newValue == true){
                    self.settings.settings.plugins.costestimation.useFilamentManager(false);
                }
            });
        };


        // self.filesViewModel.getCostsInformation = function(fileItem){
        //     // if (fileItem.DisplayLayerProgress != null){
        //     //     return parseInt(fileItem.DisplayLayerProgress.totalLayerCountWithoutOffset) + parseInt(self.settingsViewModel.settings.plugins.DisplayLayerProgress.layerOffset());
        //     // }
        //     // console.error(fileItem);
        //
        //     return "1.23€";
        // };

        // startup
        self.onStartup = function () {
            // // get orig file-item html and add "Layers:"
            // $("#files_template_machinecode").text(function(){
            //     var origFileListHtml = $(this).text();
            //     // var patchedFileItemHtml = origFileListHtml.replace('formatSize(size)"></span></div>', 'formatSize(size)"></span></div>' +
            //     //                         '<div class="size" data-bind="visible: ($root.settingsViewModel.settings.plugins.DisplayLayerProgress.showOnFileListView() == true)" >Layers: <span data-bind="text: $root.getLayerInformation($data)"></span></div>');
            //     var patchedFileItemHtml = origFileListHtml.replace('formatSize(size)"></span></div>', 'formatSize(size)"></span></div>' +
            //                             '<div class="size" >Costs: <span data-bind="text: $root.getCostsInformation($data)"></span></div>');
            //     return patchedFileItemHtml;
            // });
        };

        self.onAfterBinding = function(){
            if (self.filamentManager === null){
                self.settings.settings.plugins.costestimation.useFilamentManager(false);
            }
            if (self.spoolManager === null){
                self.settings.settings.plugins.costestimation.useSpoolManager(false);
            }
        }

        self.readSpoolManagerData = function() {
            // needed data
            // costOfFilament = spoolData[tool].cost;
            // weightOfFilament =  spoolData[tool].weight;
            // densityOfFilament = spoolData[tool].profile.density;
            // diameterOfFilament = spoolData[tool].profile.diameter;

            if (self.spoolManager == null || self.settings.settings.plugins.costestimation.useSpoolManager() == false)
                return null;

            var selectedSpool = self.spoolManager.api_getSelectedSpoolInformations();
            if (!selectedSpool) return null;
            var result = [];
            for (const spoolInfo of selectedSpool) {
                var spoolData = null;
                if (spoolInfo != null) {
                    spoolData = {
                        cost: spoolInfo.cost || 0,
                        profile: {
                            density: spoolInfo.density || 0,
                            diameter: spoolInfo.diameter || 0
                        },
                        weight: spoolInfo.weight || 0
                    }
                }
                result.push(spoolData)
            }
            return result;
        };

        /////////////////////////////////////////////////////////////////////// API-Calls
        var callCount = 0;
        self.callSendCostsToServer = function (costData, responseHandler){
            callCount++;
            // console.error(callCount);
            jsonPayload = ko.toJSON(costData);

            $.ajax({
                //url: API_BASEURL + "plugin/"+PLUGIN_ID+"/loadPrintJobHistory",
                url: BASEURL + "plugin/" + PLUGIN_ID + "/storeCurrentCosts",
                dataType: "json",
                contentType: "application/json; charset=UTF-8",
                data: jsonPayload,
                type: "PUT"
            }).done(function( data ){
                responseHandler();
            });
        }
    }

    OCTOPRINT_VIEWMODELS.push({
        construct: CostEstimationViewModel,
        dependencies: ["printerStateViewModel", "settingsViewModel",
                       "loginStateViewModel", "filamentManagerViewModel",
                       "spoolManagerViewModel", "filesViewModel"],
        optional: ["filamentManagerViewModel","spoolManagerViewModel"],
        elements: ["#costestimation_string", "#settings_plugin_costestimation"]
    });
});

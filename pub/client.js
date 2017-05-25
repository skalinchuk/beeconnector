// --------------------------------- 80chars ---------------------------------->
/* global angular */ // keeps JSLint from complaining

"use strict";

var app = angular.module('beeApp', []);

app.controller("goalConnect", goalConnect);

goalConnect.$inject = ["$scope", "$http"];

function goalConnect($scope, $http) {
  
  $scope.currentStage = 'initialScreen';
  $scope.goals = null;
  $scope.beeGoals = null;
  $scope.newConnection = {};
  $scope.initialScreenError = null;
  $scope.creatingBeeminderGoal = false;
  
  function init () {
    
    $http({
      method: 'get',
      url: '/get-links'
    }).then( (result) => {
      $scope.initialScreenError = null;
      $scope.goals = result.data.goals;
      $scope.connections = result.data.connections;
      $scope.beeminderGoals = result.data.beeGoals;
      $scope.currentStage = 'goalsList';
      $scope.action = 'Continue';
      $scope.newConnection = {};
      $scope.newBeeGoal = {};
    }, (result) => {
      if(typeof result.data.error != 'undefined'){
        $scope.initialScreenError = {
          error: result.data.error, 
          error_description: result.data.error_description
        }
      } else {
        if (result.status != 404)
          $scope.initialScreenError = {
            error: 'Application error', 
            error_description: result.statusText
          }
      }
    })
  }
  
  init();
  
  $scope.toggleCreateBeeminderGoal = () => {
    $scope.creatingBeeminderGoal = !$scope.creatingBeeminderGoal
    if($scope.creatingBeeminderGoal && 
       typeof $scope.newBeeGoal.runits == 'undefined') {
      $scope.newBeeGoal.runits = 'w'
    }
    if(!$scope.creatingBeeminderGoal) $scope.newConnection.startValue = null;
  }
  
  $scope.deleteLink = (id) => {
    var c = confirm ("Do you really want to delete this connection?")
    if(c){
      $http({
        method: 'get',
        url: '/delete-link?id=' + id
      }).then( (result) => {
        init();
      });
    }
  }
  
  $scope.addConnection = (type) => {
    $scope.currentStage = 'new'+type;
    $scope.action = 'Continue';
    $scope.sourceError = null;
    $scope.targetError = null;
  }
  
  $scope.cancelConnection = () => {
    init();
  }
  
  $scope.resetSource = () => {
    $scope.sourceError = null;
    $scope.newConnection.startValue = null;
    $scope.newConnection.score = null;
    $scope.action = 'Continue';
  }

  $scope.resetSource = () => {
    $scope.sourceError = null;
    $scope.newConnection.startValue = null;
    $scope.newConnection.score = null;
    $scope.action = 'Continue';
  }

  $scope.submitConnection = (type) => {
    $('#actionButton').addClass("disabled");
    if ($scope.creatingBeeminderGoal){
      var err_msg = '';
      if (typeof $scope.newBeeGoal.slug === 'undefined' || 
                 $scope.newBeeGoal.slug.trim().length === 0) 
        err_msg += "Goal name can't be blank\n";
      if (typeof $scope.newBeeGoal.rate === 'undefined' || 
                 $scope.newBeeGoal.rate*1 === 0 || 
                 $scope.newBeeGoal.rate*1 !== $scope.newBeeGoal.rate) 
        err_msg += 'Goal rate must be a positive number\n';
      if (typeof $scope.newBeeGoal.goalval === 'undefined' || 
                 $scope.newBeeGoal.goalval*1 === 0 || 
                 $scope.newBeeGoal.goalval*1 !== $scope.newBeeGoal.goalval) 
        err_msg += 'Final goal value must be a positive number\n';
      if ($scope.newConnection.startValue >0 && 
          $scope.newBeeGoal.goalval < $scope.newConnection.startValue) 
        err_msg += 'Current score must be less than final goal value\n';
      if (err_msg != '') { 
        alert (err_msg); 
        $('#actionButton').removeClass("disabled"); 
        return; 
      }
    } else if (typeof $scope.newConnection.goal === 'undefined' || 
                      $scope.newConnection.goal === '') {
      alert ('Please select the goal');
      $('#actionButton').removeClass("disabled"); 
      return;
    }
    if (typeof $scope.newConnection.params === 'undefined') {
      alert ('Please fill in all fields');
      $('#actionButton').removeClass("disabled"); 
      return;
    }
    
    $http({
      method: 'POST',
      url: '/setup-link',
      data: { linktype: type, 
              newConnection: $scope.newConnection, 
              action: $scope.action,
              creatingBeeminderGoal: $scope.creatingBeeminderGoal,
              newBeeGoal: 
                ($scope.creatingBeeminderGoal ? $scope.newBeeGoal : null),
            }
    }).then( (result)=> {
      $('#actionButton').removeClass("disabled");
      if($scope.action == 'Save') {
        init();
        return;
      }
      $scope.beeminderGoals = result.data.beeGoals;
      $scope.newConnection = result.data.newConnection;
      $scope.targetError = result.data.targetError;
      $scope.sourceError = result.data.sourceError;
      if (typeof $scope.newConnection.startValue !== "undefined" && 
          typeof $scope.sourceError === "undefined" && 
          typeof $scope.targetError === "undefined") { 
        $scope.action = 'Save' 
      } else { 
        $scope.action = 'Continue' 
      }
    }, (err) => {
      $('#actionButton').removeClass("disabled");
      alert(err.data);
    })
  }
}
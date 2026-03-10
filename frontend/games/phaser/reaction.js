registerGame("reaction", "⚡ Reaction Time", "SPACE = P1, ENTER = P2", "React fastest when the screen turns green!", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a2e");
    this.bg=this.add.rectangle(W/2,H/2,W,H,0x1a1a2e);
    this.msgTxt=this.add.text(W/2,H/2,"Get ready...",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.s1=0;this.s2=0;this.round=0;this.maxRounds=5;
    this.sTxt=this.add.text(W/2,30,"P1: 0 | P2: 0  (best of 5)",{fontSize:"18px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.state="waiting";
    this.input.keyboard.on("keydown-SPACE",()=>this.react("P1"));
    this.input.keyboard.on("keydown-ENTER",()=>this.react("P2"));
    this.startRound();
  }
  startRound(){this.state="waiting";this.bg.fillColor=0x1a1a2e;this.msgTxt.setText("Wait for GREEN...").setColor("#fff");
    this.time.delayedCall(Phaser.Math.Between(2000,5000),()=>{if(this.state==="waiting"){this.state="go";this.bg.fillColor=0x1a4a1a;this.msgTxt.setText("GO!").setColor("#4ecca3");this.goTime=this.time.now;}});}
  react(who){
    if(this.state==="done")return;
    if(this.state==="waiting"){this.msgTxt.setText(who+" too early! Other player gets point").setColor("#e94560").setFontSize(22);
      if(who==="P1")this.s2++;else this.s1++;}
    else if(this.state==="go"){const ms=Math.round(this.time.now-this.goTime);
      this.msgTxt.setText(who+" reacted in "+ms+"ms!").setColor("#f7c948").setFontSize(28);
      if(who==="P1")this.s1++;else this.s2++;}
    this.state="cooldown";this.round++;
    this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);
    if(this.round>=this.maxRounds){this.state="done";this.time.delayedCall(1500,()=>{this.bg.fillColor=0x1a1a2e;this.msgTxt.setText((this.s1>this.s2?"P1":"P2")+" WINS!").setColor("#f7c948").setFontSize(40);});}
    else this.time.delayedCall(2000,()=>this.startRound());
  }
  update(){}
});

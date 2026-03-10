registerGame("balloon-pop", "🎈 Balloon Pop", "Click balloons to pop them!", "Pop the most balloons before time runs out", class extends Phaser.Scene {
  create() {
    this.cameras.main.setBackgroundColor("#1a1a3e");
    this.s1=0;this.s2=0;this.balloons=[];
    this.sTxt=this.add.text(W/2,16,"P1(click left half): 0 | P2(click right half): 0",{fontSize:"14px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
    this.add.rectangle(W/2,H/2,2,H,0x333355);
    this.timeLeft=15;
    this.timeTxt=this.add.text(W/2,H-14,this.timeLeft+"s",{fontSize:"16px",color:"#888",fontFamily:"monospace"}).setOrigin(0.5);
    this.time.addEvent({delay:1000,callback:()=>{if(--this.timeLeft<=0){
      this.add.text(W/2,H/2,(this.s1>this.s2?"P1":"P2")+" WINS!",{fontSize:"36px",color:"#fff",fontFamily:"monospace"}).setOrigin(0.5);
      this.input.off("pointerdown");}this.timeTxt.setText(this.timeLeft+"s");},loop:true});
    this.time.addEvent({delay:400,callback:()=>this.spawnBalloon(),loop:true});
    this.input.on("pointerdown",(ptr)=>{
      const who=ptr.x<W/2?"P1":"P2";
      for(let i=this.balloons.length-1;i>=0;i--){const b=this.balloons[i];
        if(b.active&&Phaser.Math.Distance.Between(ptr.x,ptr.y,b.x,b.y)<25){
          if(who==="P1"&&b.x<W/2){this.s1++;b.destroy();this.balloons.splice(i,1);}
          else if(who==="P2"&&b.x>=W/2){this.s2++;b.destroy();this.balloons.splice(i,1);}
          this.sTxt.setText("P1: "+this.s1+" | P2: "+this.s2);break;
        }}});
  }
  spawnBalloon(){
    const colors=[0xe94560,0xf7c948,0x4ecca3,0x5dade2,0xaf7ac5];
    const x=Phaser.Math.Between(40,W-40),b=this.add.circle(x,H+20,18,Phaser.Utils.Array.GetRandom(colors));
    this.physics.add.existing(b);b.body.setVelocityY(Phaser.Math.Between(-180,-80));b.body.setAllowGravity(false);
    this.balloons.push(b);this.time.delayedCall(5000,()=>{if(b.active)b.destroy();});
  }
  update(){}
});
